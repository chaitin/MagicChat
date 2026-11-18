package organization

import (
	"context"
	"errors"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

// Reporting is a member property. Department leaders and memberships do not
// create reporting edges.
func (s *Service) Reporting(ctx context.Context, userID string) (Reporting, error) {
	if !validID(userID) {
		return Reporting{}, ErrInvalid
	}
	userID = canonicalID(userID)
	var user store.User
	if err := s.db.WithContext(ctx).Select("id").First(&user, "id = ?", userID).Error; err != nil {
		return Reporting{}, classifyNotFound(err)
	}
	var row store.OrganizationMemberReporting
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Take(&row).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return Reporting{}, err
	}
	var dotted []store.OrganizationMemberDottedManager
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Order("manager_user_id").Find(&dotted).Error; err != nil {
		return Reporting{}, err
	}
	result := Reporting{DirectManagerUserID: row.DirectManagerUserID, DottedManagerUserIDs: make([]string, 0, len(dotted))}
	for _, manager := range dotted {
		result.DottedManagerUserIDs = append(result.DottedManagerUserIDs, manager.ManagerUserID)
	}
	return result, nil
}

func (s *Service) SetReporting(ctx context.Context, actor, userID string, input Reporting) (Reporting, error) {
	if !validID(userID) || len(input.DottedManagerUserIDs) > 400 {
		return Reporting{}, ErrInvalid
	}
	userID = canonicalID(userID)
	var managerID *string
	if input.DirectManagerUserID != nil {
		if !validID(*input.DirectManagerUserID) {
			return Reporting{}, ErrInvalid
		}
		id := canonicalID(*input.DirectManagerUserID)
		if id == userID {
			return Reporting{}, ErrInvalid
		}
		managerID = &id
	}
	seen := map[string]bool{}
	dotted := make([]store.OrganizationMemberDottedManager, 0, len(input.DottedManagerUserIDs))
	for _, rawID := range input.DottedManagerUserIDs {
		if !validID(rawID) {
			return Reporting{}, ErrInvalid
		}
		id := canonicalID(rawID)
		if id == userID || seen[id] || (managerID != nil && id == *managerID) {
			return Reporting{}, ErrInvalid
		}
		seen[id] = true
		dotted = append(dotted, store.OrganizationMemberDottedManager{UserID: userID, ManagerUserID: id})
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			// Serialize reporting changes so simultaneous edits cannot form a cycle.
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(740831519)).Error; err != nil {
				return err
			}
		}
		if err := requireActiveUser(tx, &userID); err != nil {
			return err
		}
		if err := requireActiveUser(tx, managerID); err != nil {
			return err
		}
		for _, item := range dotted {
			id := item.ManagerUserID
			if err := requireActiveUser(tx, &id); err != nil {
				return err
			}
		}
		var before store.OrganizationMemberReporting
		if err := tx.Where("user_id = ?", userID).Take(&before).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var beforeDotted []store.OrganizationMemberDottedManager
		if err := tx.Where("user_id = ?", userID).Find(&beforeDotted).Error; err != nil {
			return err
		}
		beforeReporting := Reporting{DirectManagerUserID: before.DirectManagerUserID, DottedManagerUserIDs: make([]string, 0, len(beforeDotted))}
		for _, item := range beforeDotted {
			beforeReporting.DottedManagerUserIDs = append(beforeReporting.DottedManagerUserIDs, item.ManagerUserID)
		}
		after := store.OrganizationMemberReporting{UserID: userID, DirectManagerUserID: managerID, UpdatedAt: time.Now().UTC()}
		if err := tx.Save(&after).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&store.OrganizationMemberDottedManager{}).Error; err != nil {
			return err
		}
		if len(dotted) > 0 {
			if err := tx.Create(&dotted).Error; err != nil {
				return err
			}
		}
		if err := ensureAcyclicReporting(tx); err != nil {
			return err
		}
		return audit(tx, actor, "member.reporting", "user", userID, beforeReporting, input)
	})
	if err != nil {
		return Reporting{}, err
	}
	return s.Reporting(ctx, userID)
}

func ensureAcyclicReporting(tx *gorm.DB) error {
	var rows []store.OrganizationMemberReporting
	if err := tx.Select("user_id", "direct_manager_user_id").Find(&rows).Error; err != nil {
		return err
	}
	parent := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.DirectManagerUserID != nil {
			parent[row.UserID] = *row.DirectManagerUserID
		}
	}
	state := map[string]uint8{}
	var visit func(string) bool
	visit = func(id string) bool {
		if state[id] == 1 {
			return false
		}
		if state[id] == 2 {
			return true
		}
		state[id] = 1
		if next := parent[id]; next != "" && !visit(next) {
			return false
		}
		state[id] = 2
		return true
	}
	for id := range parent {
		if !visit(id) {
			return ErrConflict
		}
	}
	return nil
}

func (s *Service) ReportingForViewer(ctx context.Context, viewerID, userID string) (Reporting, error) {
	assignments, err := s.AssignmentsForViewer(ctx, viewerID, userID)
	if err != nil {
		return Reporting{}, err
	}
	if len(assignments) == 0 {
		return Reporting{DottedManagerUserIDs: []string{}}, nil
	}
	result, err := s.Reporting(ctx, userID)
	if err != nil {
		return Reporting{}, err
	}
	visible, err := s.VisibleUserIDs(ctx, viewerID)
	if err != nil {
		return Reporting{}, err
	}
	if visible == nil {
		return result, nil
	}
	allowed := make(map[string]bool, len(visible))
	for _, id := range visible {
		allowed[id] = true
	}
	if result.DirectManagerUserID != nil && !allowed[*result.DirectManagerUserID] {
		result.DirectManagerUserID = nil
	}
	filtered := make([]string, 0, len(result.DottedManagerUserIDs))
	for _, id := range result.DottedManagerUserIDs {
		if allowed[id] {
			filtered = append(filtered, id)
		}
	}
	result.DottedManagerUserIDs = filtered
	return result, nil
}

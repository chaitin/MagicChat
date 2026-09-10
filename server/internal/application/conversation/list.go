package conversation

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"app/internal/appregistry"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	clientConversationListLimit         = 30
	topicConversationListActivityWindow = 30 * time.Minute
)

type topicConversationListGroup struct {
	ParentConversationID string
}

func (s *Service) List(ctx context.Context, cmd ListCommand) (ListResult, error) {
	db := s.db.WithContext(ctx)
	accountID := strings.TrimSpace(cmd.AccountID)
	includeConversationID := strings.TrimSpace(cmd.IncludeConversationID)
	if includeConversationID != "" {
		normalizedID, err := normalizeConversationID(includeConversationID)
		if err != nil {
			return ListResult{}, invalidRequest(err.Error(), err)
		}
		includeConversationID = normalizedID
	}
	assistantID := builtinAssistantConversationID(accountID)
	assistant, hasAssistant, err := s.ensureBuiltinAssistantConversation(db, accountID)
	if err != nil {
		return ListResult{}, internalError(err)
	}
	var preferences []store.ConversationUserPreference
	if err := db.Where("user_id = ?", accountID).Find(&preferences).Error; err != nil {
		return ListResult{}, internalError(err)
	}
	preferencesByConversation := make(map[string]store.ConversationUserPreference, len(preferences))
	for _, preference := range preferences {
		preferencesByConversation[preference.ConversationID] = preference
	}
	if hasAssistant && !conversationVisibleForPreference(assistant, preferencesByConversation[assistant.ID]) {
		hasAssistant = false
	}
	groupLimit := clientConversationListLimit
	if hasAssistant {
		groupLimit--
	}
	var parentConversations []store.Conversation
	if err := db.Model(&store.Conversation{}).
		Joins("JOIN conversation_members cm ON cm.conversation_id = conversations.id").
		Joins("LEFT JOIN conversation_user_preferences cup ON cup.conversation_id = conversations.id AND cup.user_id = ?", accountID).
		Where("cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL", store.ConversationMemberTypeUser, accountID).
		Where("conversations.id <> ?", assistantID).
		Where("conversations.kind <> ?", store.ConversationKindTopic).
		Where("conversations.status = ?", store.ConversationStatusActive).
		Where("cup.hidden_through_seq IS NULL OR conversations.last_message_seq > cup.hidden_through_seq").
		Order("CASE WHEN COALESCE(cup.pinned, false) THEN 0 ELSE 1 END ASC").
		Order("COALESCE(conversations.last_message_at, conversations.created_at) DESC").
		Order("conversations.id ASC").Limit(groupLimit).Find(&parentConversations).Error; err != nil {
		return ListResult{}, internalError(err)
	}

	topicActivityCutoff := s.now().UTC().Add(-topicConversationListActivityWindow)
	var topicGroups []topicConversationListGroup
	topicGroupQuery := db.Model(&store.Conversation{}).
		Select("ct.parent_conversation_id AS parent_conversation_id").
		Joins("JOIN conversation_topic_participants ctp ON ctp.conversation_id = conversations.id").
		Joins("JOIN conversation_topics ct ON ct.conversation_id = conversations.id").
		Joins("JOIN conversations parent_conversations ON parent_conversations.id = ct.parent_conversation_id").
		Joins("JOIN conversation_members parent_cm ON parent_cm.conversation_id = ct.parent_conversation_id").
		Joins("LEFT JOIN conversation_user_preferences cup ON cup.conversation_id = conversations.id AND cup.user_id = ?", accountID).
		Where("ctp.participant_type = ? AND ctp.participant_id = ?", store.ConversationMemberTypeUser, accountID).
		Where("parent_cm.member_type = ? AND parent_cm.member_id = ? AND parent_cm.left_at IS NULL", store.ConversationMemberTypeUser, accountID).
		Where("ct.source_message_seq >= CASE WHEN parent_cm.history_visible_from_seq < 1 THEN 1 ELSE parent_cm.history_visible_from_seq END").
		Where("ct.archived_at IS NULL").
		Where("conversations.status = ? AND parent_conversations.status = ?", store.ConversationStatusActive, store.ConversationStatusActive).
		Where("cup.hidden_through_seq IS NULL OR conversations.last_message_seq > cup.hidden_through_seq")
	topicGroupQuery = applyTopicConversationListActivityFilter(topicGroupQuery, topicActivityCutoff, includeConversationID)
	if err := topicGroupQuery.
		Group("ct.parent_conversation_id").
		Order("MAX(COALESCE(conversations.last_message_at, conversations.created_at)) DESC").
		Order("ct.parent_conversation_id ASC").
		Limit(MaxClientListItems).
		Scan(&topicGroups).Error; err != nil {
		return ListResult{}, internalError(err)
	}
	if !hasAssistant {
		filteredGroups := topicGroups[:0]
		for _, group := range topicGroups {
			if group.ParentConversationID != assistantID {
				filteredGroups = append(filteredGroups, group)
			}
		}
		topicGroups = filteredGroups
	}

	parentByID := make(map[string]store.Conversation, len(parentConversations)+len(topicGroups))
	for _, conversation := range parentConversations {
		parentByID[conversation.ID] = conversation
	}
	if includeConversationID != "" {
		if _, exists := parentByID[includeConversationID]; !exists {
			var includedParent store.Conversation
			result := db.Model(&store.Conversation{}).
				Joins("JOIN conversation_members cm ON cm.conversation_id = conversations.id").
				Joins("LEFT JOIN conversation_user_preferences cup ON cup.conversation_id = conversations.id AND cup.user_id = ?", accountID).
				Where("cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL", store.ConversationMemberTypeUser, accountID).
				Where("conversations.id = ?", includeConversationID).
				Where("conversations.kind <> ?", store.ConversationKindTopic).
				Where("conversations.status = ?", store.ConversationStatusActive).
				Where("cup.hidden_through_seq IS NULL OR conversations.last_message_seq > cup.hidden_through_seq").
				Take(&includedParent)
			if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
				return ListResult{}, internalError(result.Error)
			}
			if result.Error == nil {
				parentByID[includedParent.ID] = includedParent
			}
		}
	}
	missingParentIDs := make([]string, 0, len(topicGroups))
	for _, group := range topicGroups {
		if group.ParentConversationID == assistantID {
			continue
		}
		if _, ok := parentByID[group.ParentConversationID]; !ok {
			missingParentIDs = append(missingParentIDs, group.ParentConversationID)
		}
	}
	if len(missingParentIDs) > 0 {
		var missingParents []store.Conversation
		if err := db.Model(&store.Conversation{}).
			Joins("JOIN conversation_members cm ON cm.conversation_id = conversations.id").
			Where("cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL", store.ConversationMemberTypeUser, accountID).
			Where("conversations.id IN ?", missingParentIDs).
			Where("conversations.kind <> ?", store.ConversationKindTopic).
			Where("conversations.status = ?", store.ConversationStatusActive).
			Find(&missingParents).Error; err != nil {
			return ListResult{}, internalError(err)
		}
		for _, conversation := range missingParents {
			parentByID[conversation.ID] = conversation
		}
	}

	candidateParentIDs := make([]string, 0, len(parentByID))
	for parentID := range parentByID {
		candidateParentIDs = append(candidateParentIDs, parentID)
	}
	if hasAssistant {
		candidateParentIDs = append(candidateParentIDs, assistantID)
	}
	var topicConversations []store.Conversation
	if len(candidateParentIDs) > 0 {
		topicQuery := db.Model(&store.Conversation{}).
			Joins("JOIN conversation_topic_participants ctp ON ctp.conversation_id = conversations.id").
			Joins("JOIN conversation_topics ct ON ct.conversation_id = conversations.id").
			Joins("JOIN conversations parent_conversations ON parent_conversations.id = ct.parent_conversation_id").
			Joins("JOIN conversation_members parent_cm ON parent_cm.conversation_id = ct.parent_conversation_id").
			Joins("LEFT JOIN conversation_user_preferences cup ON cup.conversation_id = conversations.id AND cup.user_id = ?", accountID).
			Where("ctp.participant_type = ? AND ctp.participant_id = ?", store.ConversationMemberTypeUser, accountID).
			Where("parent_cm.member_type = ? AND parent_cm.member_id = ? AND parent_cm.left_at IS NULL", store.ConversationMemberTypeUser, accountID).
			Where("ct.source_message_seq >= CASE WHEN parent_cm.history_visible_from_seq < 1 THEN 1 ELSE parent_cm.history_visible_from_seq END").
			Where("ct.archived_at IS NULL").
			Where("ct.parent_conversation_id IN ?", candidateParentIDs).
			Where("conversations.status = ? AND parent_conversations.status = ?", store.ConversationStatusActive, store.ConversationStatusActive).
			Where("cup.hidden_through_seq IS NULL OR conversations.last_message_seq > cup.hidden_through_seq")
		topicQuery = applyTopicConversationListActivityFilter(topicQuery, topicActivityCutoff, includeConversationID)
		if err := topicQuery.Find(&topicConversations).Error; err != nil {
			return ListResult{}, internalError(err)
		}
	}
	var topicRecords []store.ConversationTopic
	if len(topicConversations) > 0 {
		topicIDs := make([]string, 0, len(topicConversations))
		for _, conversation := range topicConversations {
			topicIDs = append(topicIDs, conversation.ID)
		}
		if err := db.Where("conversation_id IN ?", topicIDs).Find(&topicRecords).Error; err != nil {
			return ListResult{}, internalError(err)
		}
	}
	parentIDByTopicID := make(map[string]string, len(topicRecords))
	for _, topic := range topicRecords {
		parentIDByTopicID[topic.ConversationID] = topic.ParentConversationID
	}
	topicsByParentID := make(map[string][]store.Conversation, len(candidateParentIDs))
	topicActivityByParentID := make(map[string]time.Time, len(candidateParentIDs))
	for _, conversation := range topicConversations {
		parentID := parentIDByTopicID[conversation.ID]
		topicsByParentID[parentID] = append(topicsByParentID[parentID], conversation)
		activityAt := conversationListActivityAt(conversation)
		if activityAt.After(topicActivityByParentID[parentID]) {
			topicActivityByParentID[parentID] = activityAt
		}
	}
	parentConversations = parentConversations[:0]
	for _, conversation := range parentByID {
		parentConversations = append(parentConversations, conversation)
	}
	sort.Slice(parentConversations, func(left, right int) bool {
		leftConversation, rightConversation := parentConversations[left], parentConversations[right]
		leftPinned := preferencesByConversation[leftConversation.ID].Pinned
		rightPinned := preferencesByConversation[rightConversation.ID].Pinned
		if leftPinned != rightPinned {
			return leftPinned
		}
		leftAt := conversationListActivityAt(leftConversation)
		if topicAt := topicActivityByParentID[leftConversation.ID]; topicAt.After(leftAt) {
			leftAt = topicAt
		}
		rightAt := conversationListActivityAt(rightConversation)
		if topicAt := topicActivityByParentID[rightConversation.ID]; topicAt.After(rightAt) {
			rightAt = topicAt
		}
		if !leftAt.Equal(rightAt) {
			return leftAt.After(rightAt)
		}
		return leftConversation.ID < rightConversation.ID
	})
	if len(parentConversations) > groupLimit {
		includedParentID := includeConversationID
		if parentID, ok := parentIDByTopicID[includeConversationID]; ok {
			includedParentID = parentID
		}
		includedParentIndex := -1
		for index, conversation := range parentConversations {
			if conversation.ID == includedParentID {
				includedParentIndex = index
				break
			}
		}
		if includedParentIndex >= groupLimit {
			includedParent := parentConversations[includedParentIndex]
			parentConversations = append(parentConversations[:groupLimit-1], includedParent)
		} else {
			parentConversations = parentConversations[:groupLimit]
		}
	}
	conversations := make([]store.Conversation, 0, len(parentConversations)+len(topicConversations))
	if hasAssistant {
		assistantTopics := topicsByParentID[assistantID]
		sortConversationListTopics(assistantTopics)
		conversations = append(conversations, assistantTopics...)
	}
	for _, parent := range parentConversations {
		conversations = append(conversations, parent)
		topics := topicsByParentID[parent.ID]
		sortConversationListTopics(topics)
		conversations = append(conversations, topics...)
	}
	ids := make([]string, 0, len(conversations)+1)
	if hasAssistant {
		ids = append(ids, assistant.ID)
	}
	for _, conversation := range conversations {
		ids = append(ids, conversation.ID)
	}
	membersByConversation, users, apps, err := s.loadListMembers(db, ids)
	if err != nil {
		return ListResult{}, internalError(err)
	}
	accessibleAppIDs, err := loadUserAccessibleAppIDSet(db, accountID, apps)
	if err != nil {
		return ListResult{}, internalError(err)
	}
	topicPresentations, err := loadTopicPresentations(db, conversations, accountID)
	if err != nil {
		return ListResult{}, internalError(err)
	}
	allConversations := make([]store.Conversation, 0, len(conversations)+1)
	if hasAssistant {
		allConversations = append(allConversations, assistant)
	}
	allConversations = append(allConversations, conversations...)
	lastMessageSenders, err := loadLastMessageSenders(db, allConversations)
	if err != nil {
		return ListResult{}, internalError(err)
	}
	projects := make(map[string][]Project, len(ids))
	if s.projects != nil {
		projectConversationSet := make(map[string]struct{}, len(ids))
		projectConversationByItem := make(map[string]string, len(ids))
		for _, conversationID := range ids {
			projectConversationID := conversationID
			if presentation, ok := topicPresentations[conversationID]; ok {
				projectConversationID = presentation.topic.ParentConversationID
			}
			projectConversationByItem[conversationID] = projectConversationID
			projectConversationSet[projectConversationID] = struct{}{}
		}
		values, err := s.projects.ListForConversations(ctx, sortedKeys(projectConversationSet))
		if err != nil {
			return ListResult{}, internalError(err)
		}
		for conversationID, projectConversationID := range projectConversationByItem {
			items := values[projectConversationID]
			projects[conversationID] = make([]Project, 0, len(items))
			for _, item := range items {
				projects[conversationID] = append(projects[conversationID], Project{Avatar: item.Avatar, Description: item.Description, ID: item.ID, Name: item.Name})
			}
		}
	}
	result := ListResult{Conversations: make([]Item, 0, len(conversations)+1)}
	appendItem := func(conversation store.Conversation) {
		item := newItem(conversation, accountID, membersByConversation[conversation.ID], users, apps)
		var parent *store.Conversation
		if presentation, ok := topicPresentations[conversation.ID]; ok {
			item = newTopicItem(conversation, accountID, membersByConversation[conversation.ID], users, apps, presentation)
			parent = &presentation.parent
		}
		item.CanSend = canUserSendConversation(conversation, parent, membersByConversation[conversation.ID], accessibleAppIDs)
		item.LastMessageSender = lastMessageSenders[conversation.ID]
		conversationProjects := projects[conversation.ID]
		if conversationProjects == nil {
			conversationProjects = []Project{}
		}
		preference := preferencesByConversation[conversation.ID]
		item.NotificationMuted = preference.NotificationMuted
		item.Pinned = preference.Pinned
		if conversation.Kind == store.ConversationKindTopic {
			item.Pinned = false
		}
		if conversation.ID == assistantID {
			item.Pinned = true
		}
		item.Projects = &conversationProjects
		result.Conversations = append(result.Conversations, item)
	}
	if hasAssistant {
		appendItem(assistant)
	}
	for _, conversation := range conversations {
		appendItem(conversation)
	}
	return result, nil
}

func applyTopicConversationListActivityFilter(db *gorm.DB, cutoff time.Time, includeConversationID string) *gorm.DB {
	if includeConversationID == "" {
		return db.Where("(COALESCE(conversations.last_message_at, conversations.created_at) >= ? OR conversations.last_message_seq > ctp.last_read_seq)", cutoff)
	}
	return db.Where("(COALESCE(conversations.last_message_at, conversations.created_at) >= ? OR conversations.last_message_seq > ctp.last_read_seq OR conversations.id = ?)", cutoff, includeConversationID)
}

func conversationListActivityAt(conversation store.Conversation) time.Time {
	if conversation.LastMessageAt != nil {
		return *conversation.LastMessageAt
	}
	return conversation.CreatedAt
}

func sortConversationListTopics(topics []store.Conversation) {
	sort.Slice(topics, func(left, right int) bool {
		leftAt, rightAt := conversationListActivityAt(topics[left]), conversationListActivityAt(topics[right])
		if !leftAt.Equal(rightAt) {
			return leftAt.After(rightAt)
		}
		return topics[left].ID < topics[right].ID
	})
}

func conversationVisibleForPreference(conversation store.Conversation, preference store.ConversationUserPreference) bool {
	return preference.HiddenThroughSeq == nil || conversation.LastMessageSeq > *preference.HiddenThroughSeq
}

func (s *Service) ensureBuiltinAssistantConversation(db *gorm.DB, userID string) (store.Conversation, bool, error) {
	assistant, err := appregistry.EnsureAIAssistantApp(db, s.apps)
	if err != nil {
		return store.Conversation{}, false, err
	}
	if !assistant.Enabled {
		return store.Conversation{}, false, nil
	}
	id, now := builtinAssistantConversationID(userID), s.now().UTC()
	conversation := store.Conversation{}
	err = db.Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&conversation, "id = ?", id).Error
		if err == nil {
			if err := ensureBuiltinAssistantConversationFields(tx, &conversation, assistant, userID, now); err != nil {
				return err
			}
			if err := ensureBuiltinAssistantConversationMembers(tx, conversation.ID, assistant.ID, userID, now); err != nil {
				return err
			}
			return ensureBuiltinAssistantAppConversation(tx, assistant.ID, conversation.ID, userID, now)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		conversation = store.Conversation{ID: id, Kind: store.ConversationKindApp, Name: assistant.Name, Avatar: assistant.Avatar, CreatedByUserID: userID, Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&conversation).Error; err != nil {
			return err
		}
		if err := ensureBuiltinAssistantConversationMembers(tx, conversation.ID, assistant.ID, userID, now); err != nil {
			return err
		}
		return ensureBuiltinAssistantAppConversation(tx, assistant.ID, conversation.ID, userID, now)
	})
	if err != nil {
		if isUniqueConstraintError(err) {
			if findErr := db.First(&conversation, "id = ?", id).Error; findErr == nil {
				return conversation, true, nil
			}
		}
		return store.Conversation{}, false, err
	}
	return conversation, true, nil
}

func ensureBuiltinAssistantConversationFields(db *gorm.DB, conversation *store.Conversation, app store.App, userID string, now time.Time) error {
	updates := map[string]any{}
	if conversation.Kind != store.ConversationKindApp {
		updates["kind"] = store.ConversationKindApp
	}
	if conversation.Name != app.Name {
		updates["name"] = app.Name
	}
	if conversation.Avatar != app.Avatar {
		updates["avatar"] = app.Avatar
	}
	if conversation.CreatedByUserID != userID {
		updates["created_by_user_id"] = userID
	}
	if conversation.Status != store.ConversationStatusActive {
		updates["status"] = store.ConversationStatusActive
	}
	if conversation.PostingPolicy != store.ConversationPostingPolicyOpen {
		updates["posting_policy"] = store.ConversationPostingPolicyOpen
	}
	if conversation.Visibility == "" {
		updates["visibility"] = store.ConversationVisibilityPrivate
	}
	if len(updates) == 0 {
		return nil
	}
	updates["updated_at"] = now
	if err := db.Model(&store.Conversation{}).Where("id = ?", conversation.ID).Updates(updates).Error; err != nil {
		return err
	}
	return db.First(conversation, "id = ?", conversation.ID).Error
}

func ensureBuiltinAssistantConversationMembers(db *gorm.DB, conversationID, appID, userID string, now time.Time) error {
	if err := ensureBuiltinAssistantConversationMember(db, store.ConversationMember{ConversationID: conversationID, MemberType: store.ConversationMemberTypeUser, MemberID: userID, Role: store.ConversationMemberRoleOwner, JoinedAt: now, HistoryVisibleFromSeq: 1}); err != nil {
		return err
	}
	return ensureBuiltinAssistantConversationMember(db, store.ConversationMember{ConversationID: conversationID, MemberType: store.ConversationMemberTypeApp, MemberID: appID, Role: store.ConversationMemberRoleMember, JoinedAt: now, HistoryVisibleFromSeq: 1})
}

func ensureBuiltinAssistantConversationMember(db *gorm.DB, member store.ConversationMember) error {
	var existing store.ConversationMember
	err := db.First(&existing, "conversation_id = ? AND member_type = ? AND member_id = ?", member.ConversationID, member.MemberType, member.MemberID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&member).Error
	}
	if err != nil {
		return err
	}
	updates := map[string]any{}
	if existing.Role != member.Role {
		updates["role"] = member.Role
	}
	if existing.HistoryVisibleFromSeq < 1 {
		updates["history_visible_from_seq"] = int64(1)
	}
	if existing.LeftAt != nil {
		updates["left_at"] = nil
	}
	if len(updates) == 0 {
		return nil
	}
	return db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ? AND member_id = ?", member.ConversationID, member.MemberType, member.MemberID).Updates(updates).Error
}

func ensureBuiltinAssistantAppConversation(db *gorm.DB, appID, conversationID, userID string, now time.Time) error {
	var existing store.AppConversation
	err := db.First(&existing, "app_id = ? AND user_id = ?", appID, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&store.AppConversation{AppID: appID, ConversationID: conversationID, UserID: userID, CreatedAt: now}).Error
	}
	if err != nil {
		return err
	}
	if existing.ConversationID == conversationID {
		return nil
	}
	return db.Model(&store.AppConversation{}).Where("app_id = ? AND user_id = ?", appID, userID).Update("conversation_id", conversationID).Error
}

func BuiltinAssistantConversationID(userID string) string {
	namespace := uuid.NewSHA1(uuid.NameSpaceURL, []byte("mygod:builtin-assistant-conversation"))
	return uuid.NewSHA1(namespace, []byte(strings.ToLower(strings.TrimSpace(userID)))).String()
}

func EnsureBuiltinAssistantConversationTx(
	db *gorm.DB,
	assistant store.App,
	recipient store.User,
	now time.Time,
) (store.Conversation, error) {
	conversationID := BuiltinAssistantConversationID(recipient.ID)
	candidate := store.Conversation{
		ID: conversationID, Kind: store.ConversationKindApp, Name: assistant.Name, Avatar: assistant.Avatar,
		CreatedByUserID: recipient.ID, Status: store.ConversationStatusActive,
		PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error; err != nil {
		return store.Conversation{}, err
	}
	var conversation store.Conversation
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&conversation, "id = ?", conversationID).Error; err != nil {
		return store.Conversation{}, err
	}
	if err := ensureBuiltinAssistantConversationFields(db, &conversation, assistant, recipient.ID, now); err != nil {
		return store.Conversation{}, err
	}
	if err := ensureBuiltinAssistantConversationMembers(db, conversation.ID, assistant.ID, recipient.ID, now); err != nil {
		return store.Conversation{}, err
	}
	if err := ensureBuiltinAssistantAppConversation(db, assistant.ID, conversation.ID, recipient.ID, now); err != nil {
		return store.Conversation{}, err
	}
	return conversation, nil
}

func builtinAssistantConversationID(userID string) string {
	return BuiltinAssistantConversationID(userID)
}

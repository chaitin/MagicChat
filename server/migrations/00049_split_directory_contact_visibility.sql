-- +goose Up
ALTER TABLE organization_policy
  ADD COLUMN show_email boolean NOT NULL DEFAULT true,
  ADD COLUMN show_phone boolean NOT NULL DEFAULT true;
UPDATE organization_policy
SET show_email = show_contact_details, show_phone = show_contact_details;

-- +goose Down
-- Keep hidden details private when returning to the combined switch.
UPDATE organization_policy SET show_contact_details = show_email AND show_phone;
ALTER TABLE organization_policy DROP COLUMN show_email, DROP COLUMN show_phone;

-- +goose Up
ALTER TABLE users
  ADD COLUMN phone text;

ALTER TABLE users
  ADD COLUMN nickname text NOT NULL DEFAULT '';

ALTER TABLE users
  ADD COLUMN avatar text;

UPDATE users
SET avatar = '/assets/avatars/builtin/01.webp'
WHERE avatar IS NULL OR avatar = '';

ALTER TABLE users
  ALTER COLUMN avatar SET NOT NULL;

CREATE UNIQUE INDEX users_phone_unique
  ON users (phone)
  WHERE phone IS NOT NULL;

-- +goose Down
DROP INDEX users_phone_unique;

ALTER TABLE users
  DROP COLUMN avatar,
  DROP COLUMN nickname,
  DROP COLUMN phone;

CREATE DATABASE IF NOT EXISTS roomsync_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE roomsync_db;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  theme VARCHAR(10) NOT NULL DEFAULT 'light',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rooms (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  city VARCHAR(160) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_room_owner (owner_user_id),
  CONSTRAINT fk_rooms_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS room_members (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'Roommate',
  photo_url VARCHAR(500) NULL,
  color VARCHAR(16) NULL,
  payment_status VARCHAR(20) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, room_id),
  UNIQUE KEY uq_room_member_user (room_id, user_id),
  CONSTRAINT fk_members_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rent_details (
  room_id CHAR(36) NOT NULL PRIMARY KEY,
  monthly_rent DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  split_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rent_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expenses (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  category VARCHAR(80) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  expense_date DATE NOT NULL,
  paid_by VARCHAR(100) NOT NULL,
  note TEXT NOT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  KEY idx_expenses_room_date (room_id, expense_date),
  CONSTRAINT fk_expenses_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expense_splits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  expense_id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  member_id VARCHAR(64) NULL,
  member_name VARCHAR(100) NOT NULL,
  share_amount DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_splits_expense FOREIGN KEY (expense_id, room_id) REFERENCES expenses(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_splits_member FOREIGN KEY (member_id, room_id) REFERENCES room_members(id, room_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  payer VARCHAR(100) NOT NULL,
  recipient VARCHAR(100) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  KEY idx_payments_room_date (room_id, payment_date),
  CONSTRAINT fk_payments_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shopping_items (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  purchase_date DATE NOT NULL,
  purchased_by VARCHAR(100) NOT NULL DEFAULT '',
  shop_name VARCHAR(180) NOT NULL DEFAULT '',
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  CONSTRAINT fk_shopping_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  purchase_date DATE NULL,
  purchased_by VARCHAR(100) NOT NULL DEFAULT '',
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  CONSTRAINT fk_inventory_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notices (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  author VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  notice_date DATE NOT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  CONSTRAINT fk_notices_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shopping_lists (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  item_name VARCHAR(180) NOT NULL,
  quantity VARCHAR(180) NOT NULL DEFAULT '',
  is_purchased BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  CONSTRAINT fk_lists_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reminders (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  assigned_to VARCHAR(100) NOT NULL DEFAULT '',
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  CONSTRAINT fk_reminders_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS calendar_events (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  event_date DATE NOT NULL,
  event_type VARCHAR(40) NOT NULL DEFAULT 'event',
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  CONSTRAINT fk_calendar_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS locations (
  id VARCHAR(64) NOT NULL,
  room_id CHAR(36) NOT NULL,
  name VARCHAR(180) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  map_url VARCHAR(1000) NOT NULL,
  location_type VARCHAR(60) NOT NULL DEFAULT '',
  payload JSON NOT NULL,
  PRIMARY KEY (id, room_id),
  CONSTRAINT fk_locations_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_sessions (
  jti CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

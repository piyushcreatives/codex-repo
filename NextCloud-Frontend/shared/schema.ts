import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── User ───────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  avatar: text("avatar"),
  role: text("role").notNull().default("user"),
  storageUsed: real("storage_used").notNull().default(0),
  storageQuota: real("storage_quota").notNull().default(53687091200), // 50GB
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Files ──────────────────────────────────────────────────
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  type: text("type").notNull(), // 'file' | 'folder'
  mimeType: text("mime_type"),
  size: integer("size").default(0),
  modifiedAt: text("modified_at").notNull(),
  sharedWith: text("shared_with"), // JSON array
  isFavourite: integer("is_favourite", { mode: "boolean" }).default(false),
  parentPath: text("parent_path").notNull().default("/"),
  ownerId: integer("owner_id").notNull().default(1),
});

export const insertFileSchema = createInsertSchema(files).omit({ id: true });
export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;

// ─── Talk (messages) ────────────────────────────────────────
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'dm' | 'group'
  avatar: text("avatar"),
  lastMessage: text("last_message"),
  lastMessageAt: text("last_message_at"),
  unreadCount: integer("unread_count").default(0),
  members: text("members"), // JSON array
  isMuted: integer("is_muted", { mode: "boolean" }).default(false),
  adminId: integer("admin_id"),
  createdBy: integer("created_by"),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  senderId: integer("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  sentAt: text("sent_at").notNull(),
  reactions: text("reactions"), // JSON: { emoji: count }
  replyToId: integer("reply_to_id"),
  systemMessage: text("system_message"), // non-null for system/notification messages
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true });
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

// ─── Calendar events ────────────────────────────────────────
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  allDay: integer("all_day", { mode: "boolean" }).default(false),
  calendar: text("calendar").notNull().default("Personal"), // 'Personal' | 'Work' | 'Shared'
  color: text("color").notNull().default("#4F46E5"),
  location: text("location"),
});

export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export type Event = typeof events.$inferSelect;

// ─── Notes ──────────────────────────────────────────────────
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  tags: text("tags"), // JSON array
  updatedAt: text("updated_at").notNull(),
  createdAt: text("created_at").notNull(),
  isPinned: integer("is_pinned", { mode: "boolean" }).default(false),
});

export const insertNoteSchema = createInsertSchema(notes).omit({ id: true });
export type Note = typeof notes.$inferSelect;

// ─── Contacts ───────────────────────────────────────────────
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  group: text("group_name").default("All"),
  avatar: text("avatar"),
  tags: text("tags"), // JSON array
});

export const insertContactSchema = createInsertSchema(contacts).omit({ id: true });
export type Contact = typeof contacts.$inferSelect;

// ─── Deck (Kanban) ──────────────────────────────────────────
export const boards = sqliteTable("boards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  color: text("color").notNull().default("#4F46E5"),
});

export const stacks = sqliteTable("stacks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  boardId: integer("board_id").notNull(),
  title: text("title").notNull(),
  order: integer("order").notNull().default(0),
});

export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stackId: integer("stack_id").notNull(),
  boardId: integer("board_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: text("due_date"),
  assignee: text("assignee"),
  priority: text("priority").notNull().default("medium"), // low | medium | high
  labels: text("labels"), // JSON array
  order: integer("order").notNull().default(0),
});

export const insertCardSchema = createInsertSchema(cards).omit({ id: true });
export type Board = typeof boards.$inferSelect;
export type Stack = typeof stacks.$inferSelect;
export type Card = typeof cards.$inferSelect;

// ─── Mail ───────────────────────────────────────────────────
export const emails = sqliteTable("emails", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  folder: text("folder").notNull().default("inbox"),
  from: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  to: text("to_addr").notNull(),
  subject: text("subject").notNull(),
  preview: text("preview").notNull(),
  body: text("body").notNull(),
  receivedAt: text("received_at").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).default(false),
  isStarred: integer("is_starred", { mode: "boolean" }).default(false),
  hasAttachment: integer("has_attachment", { mode: "boolean" }).default(false),
});

export const insertEmailSchema = createInsertSchema(emails).omit({ id: true });
export type Email = typeof emails.$inferSelect;

// ─── Activity ───────────────────────────────────────────────
export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'file' | 'share' | 'comment' | 'system' | 'talk'
  actor: text("actor").notNull(),
  actorAvatar: text("actor_avatar"),
  description: text("description").notNull(),
  subject: text("subject"),
  timestamp: text("timestamp").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).default(false),
});

export type Activity = typeof activities.$inferSelect;

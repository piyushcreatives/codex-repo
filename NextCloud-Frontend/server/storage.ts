import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  users, files, conversations, messages, events, notes, contacts,
  boards, stacks, cards, emails,
} from "../shared/schema";
import type {
  User, InsertUser, File as DbFile, InsertFile,
  Conversation, Message, Event, Note, Contact,
  Board, Stack, Card, Email,
} from "../shared/schema";

const sqlite = new Database("dev.db");
sqlite.pragma("journal_mode = WAL");

const db = drizzle(sqlite);

// ─── Create Tables ──────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    storage_used REAL NOT NULL DEFAULT 0,
    storage_quota REAL NOT NULL DEFAULT 53687091200
  );
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER DEFAULT 0,
    modified_at TEXT NOT NULL,
    shared_with TEXT,
    is_favourite INTEGER DEFAULT 0,
    parent_path TEXT NOT NULL DEFAULT '/',
    owner_id INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    avatar TEXT,
    last_message TEXT,
    last_message_at TEXT,
    unread_count INTEGER DEFAULT 0,
    members TEXT,
    is_muted INTEGER DEFAULT 0,
    admin_id INTEGER,
    created_by INTEGER
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    reactions TEXT,
    reply_to_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    all_day INTEGER DEFAULT 0,
    calendar TEXT NOT NULL DEFAULT 'Personal',
    color TEXT NOT NULL DEFAULT '#4F46E5',
    location TEXT
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    group_name TEXT DEFAULT 'All',
    avatar TEXT,
    tags TEXT
  );
  CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4F46E5'
  );
  CREATE TABLE IF NOT EXISTS stacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stack_id INTEGER NOT NULL,
    board_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    assignee TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    labels TEXT,
    "order" INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT NOT NULL DEFAULT 'inbox',
    from_name TEXT NOT NULL,
    from_email TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    preview TEXT NOT NULL,
    body TEXT NOT NULL,
    received_at TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    is_starred INTEGER DEFAULT 0,
    has_attachment INTEGER DEFAULT 0
  );
`);

// ─── Migrations for existing DBs ───────────────────────────
try { sqlite.exec("ALTER TABLE conversations ADD COLUMN is_muted INTEGER DEFAULT 0"); } catch (_e) { /* already exists */ }
try { sqlite.exec("ALTER TABLE conversations ADD COLUMN admin_id INTEGER"); } catch (_e) { /* already exists */ }
try { sqlite.exec("ALTER TABLE conversations ADD COLUMN created_by INTEGER"); } catch (_e) { /* already exists */ }

// ─── Seed Data ──────────────────────────────────────────────
function seed() {
  const existing = db.select().from(users).all();
  if (existing.length > 0) return;

  // User
  db.insert(users).values({
    name: "Piyush Sharma",
    email: "piyush@cloudspace.home",
    role: "admin",
    storageUsed: 19764235469,
    storageQuota: 53687091200,
  }).run();

  // Files — Folders
  const folders = ["Documents", "Projects", "Photos", "Music", "Videos", "Shared"];
  for (const f of folders) {
    db.insert(files).values({
      name: f, path: `/${f}`, type: "folder", mimeType: null, size: 0,
      modifiedAt: "2026-04-05T10:00:00Z", parentPath: "/", ownerId: 1,
    }).run();
  }

  // Files — Documents
  const fileData: Array<{ name: string; path: string; mimeType: string; size: number; parentPath: string }> = [
    { name: "Q1 Report.pdf", path: "/Documents/Q1 Report.pdf", mimeType: "application/pdf", size: 2516582, parentPath: "/Documents" },
    { name: "Design Mockups.fig", path: "/Projects/Design Mockups.fig", mimeType: "application/octet-stream", size: 8493465, parentPath: "/Projects" },
    { name: "Architecture.docx", path: "/Projects/Architecture.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 348160, parentPath: "/Projects" },
    { name: "Budget_2026.xlsx", path: "/Documents/Budget_2026.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 524288, parentPath: "/Documents" },
    { name: "Team Photo.jpg", path: "/Photos/Team Photo.jpg", mimeType: "image/jpeg", size: 3355443, parentPath: "/Photos" },
    { name: "Resume_v3.pdf", path: "/Documents/Resume_v3.pdf", mimeType: "application/pdf", size: 184320, parentPath: "/Documents" },
    { name: "Nextcloud_Backup.tar.gz", path: "/Nextcloud_Backup.tar.gz", mimeType: "application/gzip", size: 1288490188, parentPath: "/" },
    { name: "presentation.pptx", path: "/Projects/presentation.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 4718592, parentPath: "/Projects" },
    { name: "notes.md", path: "/Documents/notes.md", mimeType: "text/markdown", size: 12288, parentPath: "/Documents" },
    { name: "avatar.png", path: "/Photos/avatar.png", mimeType: "image/png", size: 245760, parentPath: "/Photos" },
  ];
  for (const f of fileData) {
    db.insert(files).values({
      name: f.name, path: f.path, type: "file", mimeType: f.mimeType, size: f.size,
      modifiedAt: "2026-04-05T14:30:00Z", parentPath: f.parentPath, ownerId: 1,
    }).run();
  }

  // Conversations
  db.insert(conversations).values([
    { name: "Rohan Mehra", type: "dm", lastMessage: "Can you share the design files?", lastMessageAt: "2026-04-06T11:30:00Z", unreadCount: 2, members: JSON.stringify(["Piyush Sharma", "Rohan Mehra"]) },
    { name: "Priya Kapoor", type: "dm", lastMessage: "Meeting at 3pm confirmed ✓", lastMessageAt: "2026-04-06T09:15:00Z", unreadCount: 0, members: JSON.stringify(["Piyush Sharma", "Priya Kapoor"]) },
    { name: "Arjun Singh", type: "dm", lastMessage: "Check the API contract doc", lastMessageAt: "2026-04-06T10:45:00Z", unreadCount: 1, members: JSON.stringify(["Piyush Sharma", "Arjun Singh"]) },
    { name: "Product Team", type: "group", lastMessage: "Sprint planning tomorrow 10am", lastMessageAt: "2026-04-06T12:00:00Z", unreadCount: 3, members: JSON.stringify(["Piyush Sharma", "Rohan Mehra", "Priya Kapoor", "Arjun Singh"]), adminId: 1, createdBy: 1 },
    { name: "HomeServer Admins", type: "group", lastMessage: "Nextcloud updated to 29.0.2", lastMessageAt: "2026-04-05T22:00:00Z", unreadCount: 0, members: JSON.stringify(["Piyush Sharma", "Vikram Patel", "Deepak Malhotra"]), adminId: 1, createdBy: 1 },
  ]).run();

  // Messages — 8 per conversation
  const convMessages: Array<{ convId: number; msgs: Array<{ senderId: number; senderName: string; content: string; sentAt: string }> }> = [
    { convId: 1, msgs: [
      { senderId: 1, senderName: "Piyush Sharma", content: "Hey Rohan, how's the design coming along?", sentAt: "2026-04-05T14:00:00Z" },
      { senderId: 2, senderName: "Rohan Mehra", content: "Almost done with the dashboard mockups", sentAt: "2026-04-05T14:05:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Great! Can you share a preview?", sentAt: "2026-04-05T14:10:00Z" },
      { senderId: 2, senderName: "Rohan Mehra", content: "Sure, give me 30 minutes", sentAt: "2026-04-05T14:15:00Z" },
      { senderId: 2, senderName: "Rohan Mehra", content: "Uploaded to /Projects/Design Mockups.fig", sentAt: "2026-04-05T15:00:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Looks fantastic! Love the sidebar layout", sentAt: "2026-04-05T15:30:00Z" },
      { senderId: 2, senderName: "Rohan Mehra", content: "Thanks! I'll iterate on the files view next", sentAt: "2026-04-06T10:00:00Z" },
      { senderId: 2, senderName: "Rohan Mehra", content: "Can you share the design files?", sentAt: "2026-04-06T11:30:00Z" },
    ]},
    { convId: 2, msgs: [
      { senderId: 1, senderName: "Piyush Sharma", content: "Priya, are we still on for the 3pm meeting?", sentAt: "2026-04-05T16:00:00Z" },
      { senderId: 3, senderName: "Priya Kapoor", content: "Yes! Let me send you the agenda", sentAt: "2026-04-05T16:05:00Z" },
      { senderId: 3, senderName: "Priya Kapoor", content: "We need to discuss the Q1 metrics and roadmap", sentAt: "2026-04-05T16:10:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Perfect, I'll prepare the slides", sentAt: "2026-04-05T16:20:00Z" },
      { senderId: 3, senderName: "Priya Kapoor", content: "Also, Rohan wants to demo the new dashboard", sentAt: "2026-04-06T08:00:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Sounds good, let's add 15 min for that", sentAt: "2026-04-06T08:30:00Z" },
      { senderId: 3, senderName: "Priya Kapoor", content: "Done, updated the calendar invite", sentAt: "2026-04-06T09:00:00Z" },
      { senderId: 3, senderName: "Priya Kapoor", content: "Meeting at 3pm confirmed ✓", sentAt: "2026-04-06T09:15:00Z" },
    ]},
    { convId: 3, msgs: [
      { senderId: 4, senderName: "Arjun Singh", content: "Piyush, I've updated the API contract", sentAt: "2026-04-05T11:00:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Which endpoints changed?", sentAt: "2026-04-05T11:15:00Z" },
      { senderId: 4, senderName: "Arjun Singh", content: "Mostly the Talk and Deck APIs", sentAt: "2026-04-05T11:20:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "I'll review them this afternoon", sentAt: "2026-04-05T11:30:00Z" },
      { senderId: 4, senderName: "Arjun Singh", content: "Also added error codes for 429 rate limiting", sentAt: "2026-04-05T17:00:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Nice, we need exponential backoff for those", sentAt: "2026-04-05T17:15:00Z" },
      { senderId: 4, senderName: "Arjun Singh", content: "Already documented in the TDD", sentAt: "2026-04-06T10:30:00Z" },
      { senderId: 4, senderName: "Arjun Singh", content: "Check the API contract doc", sentAt: "2026-04-06T10:45:00Z" },
    ]},
    { convId: 4, msgs: [
      { senderId: 3, senderName: "Priya Kapoor", content: "Team, let's review sprint 11 progress", sentAt: "2026-04-05T09:00:00Z" },
      { senderId: 2, senderName: "Rohan Mehra", content: "Dashboard is 80% done, just polishing animations", sentAt: "2026-04-05T09:10:00Z" },
      { senderId: 4, senderName: "Arjun Singh", content: "API contracts finalized for Talk and Deck", sentAt: "2026-04-05T09:15:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "I finished the sidebar and topbar components", sentAt: "2026-04-05T09:20:00Z" },
      { senderId: 3, senderName: "Priya Kapoor", content: "Great progress everyone! We're on track", sentAt: "2026-04-05T09:30:00Z" },
      { senderId: 2, senderName: "Rohan Mehra", content: "Should we do sprint planning Monday?", sentAt: "2026-04-06T11:00:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Monday 10am works for me", sentAt: "2026-04-06T11:30:00Z" },
      { senderId: 3, senderName: "Priya Kapoor", content: "Sprint planning tomorrow 10am", sentAt: "2026-04-06T12:00:00Z" },
    ]},
    { convId: 5, msgs: [
      { senderId: 5, senderName: "Vikram Patel", content: "Server load is stable at 12% CPU", sentAt: "2026-04-04T20:00:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Good. Any pending updates?", sentAt: "2026-04-04T20:15:00Z" },
      { senderId: 6, senderName: "Deepak Malhotra", content: "Nextcloud 29.0.2 is available", sentAt: "2026-04-04T21:00:00Z" },
      { senderId: 1, senderName: "Piyush Sharma", content: "Let's schedule the update for tonight", sentAt: "2026-04-04T21:15:00Z" },
      { senderId: 5, senderName: "Vikram Patel", content: "I'll take a backup first", sentAt: "2026-04-04T21:30:00Z" },
      { senderId: 6, senderName: "Deepak Malhotra", content: "Backup complete, starting update", sentAt: "2026-04-05T21:00:00Z" },
      { senderId: 6, senderName: "Deepak Malhotra", content: "Update went smoothly, all services green", sentAt: "2026-04-05T21:45:00Z" },
      { senderId: 6, senderName: "Deepak Malhotra", content: "Nextcloud updated to 29.0.2", sentAt: "2026-04-05T22:00:00Z" },
    ]},
  ];
  for (const conv of convMessages) {
    for (const m of conv.msgs) {
      db.insert(messages).values({
        conversationId: conv.convId, senderId: m.senderId, senderName: m.senderName,
        content: m.content, sentAt: m.sentAt,
      }).run();
    }
  }

  // Events
  db.insert(events).values([
    { title: "Sprint Planning", startAt: "2026-04-07T10:00:00Z", endAt: "2026-04-07T11:30:00Z", calendar: "Work", color: "#3B82F6", location: "Conference Room A" },
    { title: "Doctor Appointment", startAt: "2026-04-08T14:00:00Z", endAt: "2026-04-08T15:00:00Z", calendar: "Personal", color: "#10B981", location: "City Hospital" },
    { title: "Team Lunch", startAt: "2026-04-09T13:00:00Z", endAt: "2026-04-09T14:00:00Z", calendar: "Work", color: "#F97316", location: "Cafe Mocha" },
    { title: "IPL Match — MI vs RCB", startAt: "2026-04-10T00:00:00Z", endAt: "2026-04-10T23:59:00Z", allDay: true, calendar: "Personal", color: "#EF4444" },
    { title: "Product Demo", startAt: "2026-04-14T15:00:00Z", endAt: "2026-04-14T16:00:00Z", calendar: "Work", color: "#8B5CF6", description: "Demo the new CloudSpace UI to stakeholders" },
    { title: "Birthday — Rohan", startAt: "2026-04-15T00:00:00Z", endAt: "2026-04-15T23:59:00Z", allDay: true, calendar: "Personal", color: "#EC4899" },
    { title: "Quarterly Review", startAt: "2026-04-21T11:00:00Z", endAt: "2026-04-21T12:30:00Z", calendar: "Work", color: "#3B82F6", location: "Board Room" },
    { title: "Dentist", startAt: "2026-04-28T10:00:00Z", endAt: "2026-04-28T11:00:00Z", calendar: "Personal", color: "#10B981", location: "SmileCare Clinic" },
  ]).run();

  // Notes
  db.insert(notes).values([
    { title: "Nextcloud Architecture Notes", content: "The CloudSpace frontend is a standalone React application that communicates with the Nextcloud backend via OCS v2, WebDAV, CalDAV, and CardDAV APIs.\n\nKey design decisions:\n- React 18 with TypeScript for type safety\n- Tailwind CSS for utility-first styling\n- shadcn/ui for accessible component primitives\n- wouter for lightweight hash-based routing\n- TanStack Query for server state management\n\nThe architecture follows a clear separation of concerns with presentation, API, and data layers. Each screen is lazy-loaded for optimal bundle size.", tags: JSON.stringify(["architecture", "nextcloud"]), updatedAt: "2026-04-06T08:00:00Z", createdAt: "2026-04-01T10:00:00Z", isPinned: true },
    { title: "Sprint 12 Goals", content: "Sprint 12 runs from April 7–20, 2026.\n\nGoals:\n1. Complete Dashboard with all 5 widgets\n2. Finish Files browser with upload support\n3. Start Talk UI with conversation list\n4. Calendar month view implementation\n\nStretch goals:\n- Notes editor with markdown preview\n- Contacts list with search\n\nBlockers to watch:\n- WebDAV chunked upload needs testing\n- CalDAV timezone handling", tags: JSON.stringify(["sprint", "planning"]), updatedAt: "2026-04-06T09:00:00Z", createdAt: "2026-04-05T14:00:00Z", isPinned: true },
    { title: "Book List 2026", content: "Books to read this year:\n\n1. Designing Data-Intensive Applications — Martin Kleppmann\n2. The Pragmatic Programmer — Hunt & Thomas\n3. Staff Engineer — Will Larson\n4. System Design Interview Vol 2 — Alex Xu\n5. Atomic Habits — James Clear\n\nCurrently reading: Designing Data-Intensive Applications (Chapter 7 — Transactions)", tags: JSON.stringify(["personal", "books"]), updatedAt: "2026-04-03T20:00:00Z", createdAt: "2026-01-15T10:00:00Z", isPinned: false },
    { title: "Home Server Setup Checklist", content: "Hardware: Intel NUC 12 Pro, 32GB RAM, 2TB NVMe + 4TB HDD\n\nServices running:\n- Nextcloud 29.0.2 (Docker)\n- Collabora Online (document editing)\n- TURN server for Talk video calls\n- Redis for caching\n- MariaDB 10.11\n- Nginx reverse proxy with Let's Encrypt\n\nBackup strategy:\n- Daily incremental to external HDD\n- Weekly full backup to Backblaze B2\n- Database dumps every 6 hours", tags: JSON.stringify(["homelab", "server"]), updatedAt: "2026-04-05T22:30:00Z", createdAt: "2026-02-10T08:00:00Z", isPinned: false },
    { title: "Meeting Notes — Apr 6", content: "Attendees: Piyush, Priya, Rohan, Arjun\n\nAgenda:\n1. Sprint 11 retrospective\n2. Design review of dashboard mockups\n3. API contract finalization\n\nKey decisions:\n- Dashboard will have 5 default widgets with drag-to-rearrange\n- Files browser will use virtual scrolling for large directories\n- Talk will poll every 10 seconds (no WebSocket in Phase 1)\n\nAction items:\n- Piyush: Finish app shell and login page\n- Rohan: Iterate on files view design\n- Arjun: Document WebRTC signaling flow\n- Priya: Update project timeline in Linear", tags: JSON.stringify(["meeting", "sprint"]), updatedAt: "2026-04-06T10:00:00Z", createdAt: "2026-04-06T09:30:00Z", isPinned: false },
  ]).run();

  // Contacts
  db.insert(contacts).values([
    { name: "Rohan Mehra", email: "rohan@designstudio.in", phone: "+91 98765 43210", company: "Design Studio", group: "Work" },
    { name: "Priya Kapoor", email: "priya@techcorp.in", phone: "+91 98765 43211", company: "TechCorp India", group: "Work" },
    { name: "Arjun Singh", email: "arjun@devhouse.io", phone: "+91 98765 43212", company: "DevHouse", group: "Work" },
    { name: "Neha Joshi", email: "neha@startup.co", phone: "+91 98765 43213", company: "LaunchPad Startups", group: "Work" },
    { name: "Vikram Patel", email: "vikram@infra.net", phone: "+91 98765 43214", company: "InfraOps", group: "Friends" },
    { name: "Anjali Sharma", email: "anjali@cloudnine.in", phone: "+91 98765 43215", company: "CloudNine Solutions", group: "Family" },
    { name: "Rahul Gupta", email: "rahul@webworks.in", phone: "+91 98765 43216", company: "WebWorks", group: "Work" },
    { name: "Kavita Nair", email: "kavita@dataflow.io", phone: "+91 98765 43217", company: "DataFlow Analytics", group: "Work" },
    { name: "Deepak Malhotra", email: "deepak@sysadmin.in", phone: "+91 98765 43218", company: "SysAdmin Pro", group: "Friends" },
    { name: "Sneha Reddy", email: "sneha@pixelcraft.in", phone: "+91 98765 43219", company: "PixelCraft Design", group: "Work" },
  ]).run();

  // Boards & Stacks & Cards
  db.insert(boards).values([
    { title: "Product Roadmap", color: "#4F46E5" },
    { title: "Sprint 12", color: "#10B981" },
  ]).run();

  // Board 1 stacks
  db.insert(stacks).values([
    { boardId: 1, title: "Backlog", order: 0 },
    { boardId: 1, title: "In Progress", order: 1 },
    { boardId: 1, title: "In Review", order: 2 },
    { boardId: 1, title: "Done", order: 3 },
  ]).run();

  // Board 2 stacks
  db.insert(stacks).values([
    { boardId: 2, title: "Backlog", order: 0 },
    { boardId: 2, title: "In Progress", order: 1 },
    { boardId: 2, title: "In Review", order: 2 },
    { boardId: 2, title: "Done", order: 3 },
  ]).run();

  // Board 1 cards (Product Roadmap)
  const b1Cards = [
    { stackId: 1, boardId: 1, title: "Media gallery with EXIF support", priority: "low", labels: JSON.stringify(["feature"]), order: 0 },
    { stackId: 1, boardId: 1, title: "Mail thread view", priority: "medium", labels: JSON.stringify(["feature"]), order: 1 },
    { stackId: 1, boardId: 1, title: "Settings page — 2FA setup", priority: "high", labels: JSON.stringify(["security"]), order: 2 },
    { stackId: 2, boardId: 1, title: "Dashboard widget grid", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["feature"]), order: 0, dueDate: "2026-04-10" },
    { stackId: 2, boardId: 1, title: "Files browser — drag & drop upload", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["feature"]), order: 1, dueDate: "2026-04-12" },
    { stackId: 2, boardId: 1, title: "Talk conversation list", priority: "medium", assignee: "Rohan Mehra", labels: JSON.stringify(["feature"]), order: 2, dueDate: "2026-04-14" },
    { stackId: 3, boardId: 1, title: "Design system tokens", priority: "high", assignee: "Rohan Mehra", labels: JSON.stringify(["design"]), order: 0 },
    { stackId: 3, boardId: 1, title: "API contract — CalDAV endpoints", priority: "medium", assignee: "Arjun Singh", labels: JSON.stringify(["api"]), order: 1 },
    { stackId: 4, boardId: 1, title: "Project scaffold & tooling", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["infra"]), order: 0 },
    { stackId: 4, boardId: 1, title: "App shell — sidebar & topbar", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["feature"]), order: 1 },
    { stackId: 4, boardId: 1, title: "Login page", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["feature"]), order: 2 },
  ];
  for (const c of b1Cards) {
    db.insert(cards).values(c).run();
  }

  // Board 2 cards (Sprint 12)
  const b2Cards = [
    { stackId: 5, boardId: 2, title: "Calendar day view", priority: "medium", labels: JSON.stringify(["feature"]), order: 0 },
    { stackId: 5, boardId: 2, title: "Notes markdown preview", priority: "low", labels: JSON.stringify(["feature"]), order: 1 },
    { stackId: 5, boardId: 2, title: "Contacts .vcf import", priority: "low", labels: JSON.stringify(["feature"]), order: 2 },
    { stackId: 6, boardId: 2, title: "Dashboard — storage ring widget", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["feature"]), order: 0, dueDate: "2026-04-09" },
    { stackId: 6, boardId: 2, title: "Dashboard — recent files widget", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["feature"]), order: 1, dueDate: "2026-04-09" },
    { stackId: 6, boardId: 2, title: "Fix sidebar collapse animation jitter", priority: "medium", assignee: "Piyush Sharma", labels: JSON.stringify(["bug"]), order: 2, dueDate: "2026-04-08" },
    { stackId: 7, boardId: 2, title: "Files — breadcrumb navigation", priority: "medium", assignee: "Rohan Mehra", labels: JSON.stringify(["feature"]), order: 0 },
    { stackId: 7, boardId: 2, title: "Dark mode token audit", priority: "high", assignee: "Rohan Mehra", labels: JSON.stringify(["design"]), order: 1 },
    { stackId: 8, boardId: 2, title: "Login page with validation", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["feature"]), order: 0 },
    { stackId: 8, boardId: 2, title: "Mock server seed data", priority: "high", assignee: "Piyush Sharma", labels: JSON.stringify(["infra"]), order: 1 },
    { stackId: 8, boardId: 2, title: "CI pipeline — lint + typecheck", priority: "medium", assignee: "Arjun Singh", labels: JSON.stringify(["infra"]), order: 2 },
  ];
  for (const c of b2Cards) {
    db.insert(cards).values(c).run();
  }

  // Emails
  db.insert(emails).values([
    // Inbox
    { folder: "inbox", from: "Arjun Singh", fromEmail: "arjun@devhouse.io", to: "piyush@cloudspace.home", subject: "Re: API Contract Review", preview: "I've updated the Talk and Deck endpoints...", body: "Hi Piyush,\n\nI've updated the Talk and Deck endpoints based on your feedback. The error codes section now includes 429 rate limiting with exponential backoff details. Please review when you get a chance.\n\nBest,\nArjun", receivedAt: "2026-04-06T10:30:00Z", isRead: false, hasAttachment: true },
    { folder: "inbox", from: "Priya Kapoor", fromEmail: "priya@techcorp.in", to: "piyush@cloudspace.home", subject: "Q1 Design Review Feedback", preview: "The dashboard mockups look great...", body: "Hi Piyush,\n\nThe dashboard mockups look great. I especially like the widget grid layout. A few suggestions: can we add a storage quota ring widget? Also, the activity feed should show more context per item.\n\nLet's discuss at the 3pm meeting.\n\nPriya", receivedAt: "2026-04-06T09:00:00Z", isRead: true },
    { folder: "inbox", from: "Nextcloud", fromEmail: "noreply@nextcloud.com", to: "piyush@cloudspace.home", subject: "Nextcloud Update Available — 29.0.3", preview: "A new version of Nextcloud is available...", body: "Hello,\n\nNextcloud 29.0.3 is now available with security patches and performance improvements. We recommend updating at your earliest convenience. See the changelog for details.\n\nThe Nextcloud Team", receivedAt: "2026-04-06T07:00:00Z", isRead: false },
    { folder: "inbox", from: "Rohan Mehra", fromEmail: "rohan@designstudio.in", to: "piyush@cloudspace.home", subject: "New comment on Sprint card", preview: "I added a comment on the Files browser card...", body: "Hey Piyush,\n\nI added a comment on the Files browser drag & drop card in the Sprint 12 board. The interaction design for multi-file upload needs some thought — should we show individual progress bars or a combined one?\n\nRohan", receivedAt: "2026-04-06T06:30:00Z", isRead: true },
    { folder: "inbox", from: "Neha Joshi", fromEmail: "neha@startup.co", to: "piyush@cloudspace.home", subject: "Team lunch tomorrow?", preview: "Are we still on for team lunch...", body: "Hi Piyush,\n\nAre we still on for team lunch tomorrow at Cafe Mocha? I was thinking we could also use the time to informally discuss the Phase 2 migration strategy.\n\nLet me know!\nNeha", receivedAt: "2026-04-05T18:00:00Z", isRead: true },
    { folder: "inbox", from: "GitHub", fromEmail: "notifications@github.com", to: "piyush@cloudspace.home", subject: "[cloudspace] PR #12: Add sidebar collapse animation", preview: "Rohan Mehra requested your review...", body: "Rohan Mehra requested your review on PR #12: Add sidebar collapse animation.\n\nChanges: 3 files changed, 45 insertions(+), 12 deletions(-)\n\nView on GitHub to review the changes.", receivedAt: "2026-04-05T16:00:00Z", isRead: false },
    { folder: "inbox", from: "Vikram Patel", fromEmail: "vikram@infra.net", to: "piyush@cloudspace.home", subject: "Server monitoring alert — resolved", preview: "The CPU spike from earlier has resolved...", body: "Hi Piyush,\n\nThe CPU spike from earlier today has resolved. It was caused by the Collabora container running a document conversion batch. I've set resource limits to prevent this from happening again.\n\nVikram", receivedAt: "2026-04-05T14:00:00Z", isRead: true },
    { folder: "inbox", from: "Kavita Nair", fromEmail: "kavita@dataflow.io", to: "piyush@cloudspace.home", subject: "Analytics dashboard requirements", preview: "Here are the metrics we should track...", body: "Hi Piyush,\n\nHere are the metrics we should track for the CloudSpace analytics dashboard: page load time, active users, storage utilization, and API response times. I can help set up the Grafana boards once the frontend is ready.\n\nKavita", receivedAt: "2026-04-05T11:00:00Z", isRead: true },
    // Sent
    { folder: "sent", from: "Piyush Sharma", fromEmail: "piyush@cloudspace.home", to: "arjun@devhouse.io", subject: "Re: API Contract Review", preview: "Looks good! A few comments on the...", body: "Hi Arjun,\n\nLooks good! A few comments on the WebDAV section — we should document the PROPFIND depth header behavior more clearly. Also, let's add examples for the multi-status response format.\n\nPiyush", receivedAt: "2026-04-06T08:00:00Z", isRead: true },
    { folder: "sent", from: "Piyush Sharma", fromEmail: "piyush@cloudspace.home", to: "priya@techcorp.in", subject: "Re: Sprint 12 Planning", preview: "Here's my proposed breakdown...", body: "Hi Priya,\n\nHere's my proposed breakdown for Sprint 12: Dashboard (3 days), Files browser (3 days), Talk conversation list (2 days), Calendar month view (2 days). I'll create the cards in Deck.\n\nPiyush", receivedAt: "2026-04-05T15:00:00Z", isRead: true },
    { folder: "sent", from: "Piyush Sharma", fromEmail: "piyush@cloudspace.home", to: "vikram@infra.net", subject: "Re: Nextcloud Update", preview: "Let's schedule the update for tonight...", body: "Hi Vikram,\n\nLet's schedule the Nextcloud update for tonight at 9 PM. Please take a full backup before starting. Deepak can help monitor the services after the update.\n\nPiyush", receivedAt: "2026-04-04T21:00:00Z", isRead: true },
    // Drafts
    { folder: "drafts", from: "Piyush Sharma", fromEmail: "piyush@cloudspace.home", to: "sneha@pixelcraft.in", subject: "CloudSpace icon set request", preview: "Hi Sneha, we need custom icons for...", body: "Hi Sneha,\n\nWe need custom icons for a few CloudSpace-specific features that aren't covered by Lucide. Specifically: storage quota visualization, file sharing indicators, and activity type badges.", receivedAt: "2026-04-06T12:00:00Z", isRead: true },
    { folder: "drafts", from: "Piyush Sharma", fromEmail: "piyush@cloudspace.home", to: "rahul@webworks.in", subject: "Phase 2 migration consultation", preview: "Hi Rahul, I wanted to discuss the...", body: "Hi Rahul,\n\nI wanted to discuss the React-to-Vue 3 migration strategy for Phase 2. Your experience with large-scale framework migrations would be invaluable. Are you available for a call this week?", receivedAt: "2026-04-06T11:00:00Z", isRead: true },
  ]).run();
}

seed();

// ─── Storage Interface ──────────────────────────────────────
export interface IStorage {
  // Users
  getUser(id: number): User | undefined;
  getUserByEmail(email: string): User | undefined;
  createUser(user: InsertUser): User;
  updateUser(id: number, data: Partial<User>): User | undefined;
  // Files
  getAllFiles(): DbFile[];
  getFiles(parentPath: string): DbFile[];
  getFile(id: number): DbFile | undefined;
  createFile(file: InsertFile): DbFile;
  updateFile(id: number, data: Partial<DbFile>): DbFile | undefined;
  deleteFile(id: number): void;
  // Conversations
  getConversations(): Conversation[];
  getConversation(id: number): Conversation | undefined;
  createConversation(conv: { name: string; type: string; members?: string }): Conversation;
  updateConversation(id: number, data: Partial<Conversation>): Conversation | undefined;
  deleteConversation(id: number): void;
  // Messages
  getMessages(conversationId: number): Message[];
  createMessage(msg: { conversationId: number; senderId: number; senderName: string; content: string; sentAt: string }): Message;
  // Events
  getEvents(): Event[];
  getEvent(id: number): Event | undefined;
  createEvent(event: { title: string; startAt: string; endAt: string; calendar?: string; color?: string; description?: string; allDay?: boolean; location?: string }): Event;
  updateEvent(id: number, data: Partial<Event>): Event | undefined;
  deleteEvent(id: number): void;
  // Notes
  getNotes(): Note[];
  getNote(id: number): Note | undefined;
  createNote(note: { title: string; content?: string; tags?: string; isPinned?: boolean; updatedAt: string; createdAt: string }): Note;
  updateNote(id: number, data: Partial<Note>): Note | undefined;
  deleteNote(id: number): void;
  // Contacts
  getContacts(): Contact[];
  getContact(id: number): Contact | undefined;
  createContact(contact: { name: string; email?: string; phone?: string; company?: string; group?: string }): Contact;
  updateContact(id: number, data: Partial<Contact>): Contact | undefined;
  deleteContact(id: number): void;
  // Boards
  getBoards(): Board[];
  getBoard(id: number): Board | undefined;
  createBoard(board: { title: string; color?: string }): Board;
  // Stacks
  getStacks(boardId: number): Stack[];
  createStack(stack: { boardId: number; title: string; order?: number }): Stack;
  // Cards
  getCards(boardId: number): Card[];
  getCard(id: number): Card | undefined;
  createCard(card: { stackId: number; boardId: number; title: string; priority?: string; description?: string; dueDate?: string; assignee?: string; labels?: string }): Card;
  updateCard(id: number, data: Partial<Card>): Card | undefined;
  deleteCard(id: number): void;
  // Emails
  getEmails(folder: string): Email[];
  getEmail(id: number): Email | undefined;
  createEmail(email: { folder: string; from: string; fromEmail: string; to: string; subject: string; preview: string; body: string; receivedAt: string; isRead?: boolean; isStarred?: boolean; hasAttachment?: boolean }): Email;
  updateEmail(id: number, data: Partial<Email>): Email | undefined;
  deleteEmail(id: number): void;
  getEmailCounts(): { inbox: number; drafts: number; spam: number };
}

// ─── Implementation ─────────────────────────────────────────
class DatabaseStorage implements IStorage {
  getUser(id: number) { return db.select().from(users).where(eq(users.id, id)).get(); }
  getUserByEmail(email: string) { return db.select().from(users).where(eq(users.email, email)).get(); }
  createUser(user: InsertUser) { return db.insert(users).values(user).returning().get(); }
  updateUser(id: number, data: Partial<User>) {
    db.update(users).set(data).where(eq(users.id, id)).run();
    return this.getUser(id);
  }

  getAllFiles() { return db.select().from(files).all(); }
  getFiles(parentPath: string) { return db.select().from(files).where(eq(files.parentPath, parentPath)).all(); }
  getFile(id: number) { return db.select().from(files).where(eq(files.id, id)).get(); }
  createFile(file: InsertFile) { return db.insert(files).values(file).returning().get(); }
  updateFile(id: number, data: Partial<DbFile>) {
    db.update(files).set(data).where(eq(files.id, id)).run();
    return this.getFile(id);
  }
  deleteFile(id: number) { db.delete(files).where(eq(files.id, id)).run(); }

  getConversations() { return db.select().from(conversations).all(); }
  getConversation(id: number) { return db.select().from(conversations).where(eq(conversations.id, id)).get(); }
  createConversation(conv: { name: string; type: string; members?: string }) {
    return db.insert(conversations).values(conv).returning().get();
  }
  updateConversation(id: number, data: Partial<Conversation>) {
    db.update(conversations).set(data).where(eq(conversations.id, id)).run();
    return this.getConversation(id);
  }
  deleteConversation(id: number) {
    db.delete(messages).where(eq(messages.conversationId, id)).run();
    db.delete(conversations).where(eq(conversations.id, id)).run();
  }

  getMessages(conversationId: number) { return db.select().from(messages).where(eq(messages.conversationId, conversationId)).all(); }
  createMessage(msg: { conversationId: number; senderId: number; senderName: string; content: string; sentAt: string }) {
    return db.insert(messages).values(msg).returning().get();
  }

  getEvents() { return db.select().from(events).all(); }
  getEvent(id: number) { return db.select().from(events).where(eq(events.id, id)).get(); }
  createEvent(event: { title: string; startAt: string; endAt: string; calendar?: string; color?: string; description?: string; allDay?: boolean; location?: string }) {
    return db.insert(events).values(event).returning().get();
  }
  updateEvent(id: number, data: Partial<Event>) {
    db.update(events).set(data).where(eq(events.id, id)).run();
    return this.getEvent(id);
  }
  deleteEvent(id: number) { db.delete(events).where(eq(events.id, id)).run(); }

  getNotes() { return db.select().from(notes).all(); }
  getNote(id: number) { return db.select().from(notes).where(eq(notes.id, id)).get(); }
  createNote(note: { title: string; content?: string; tags?: string; isPinned?: boolean; updatedAt: string; createdAt: string }) {
    return db.insert(notes).values(note).returning().get();
  }
  updateNote(id: number, data: Partial<Note>) {
    db.update(notes).set(data).where(eq(notes.id, id)).run();
    return this.getNote(id);
  }
  deleteNote(id: number) { db.delete(notes).where(eq(notes.id, id)).run(); }

  getContacts() { return db.select().from(contacts).all(); }
  getContact(id: number) { return db.select().from(contacts).where(eq(contacts.id, id)).get(); }
  createContact(contact: { name: string; email?: string; phone?: string; company?: string; group?: string }) {
    return db.insert(contacts).values(contact).returning().get();
  }
  updateContact(id: number, data: Partial<Contact>) {
    db.update(contacts).set(data).where(eq(contacts.id, id)).run();
    return this.getContact(id);
  }
  deleteContact(id: number) { db.delete(contacts).where(eq(contacts.id, id)).run(); }

  getBoards() { return db.select().from(boards).all(); }
  getBoard(id: number) { return db.select().from(boards).where(eq(boards.id, id)).get(); }
  createBoard(board: { title: string; color?: string }) { return db.insert(boards).values(board).returning().get(); }

  getStacks(boardId: number) { return db.select().from(stacks).where(eq(stacks.boardId, boardId)).all(); }
  createStack(stack: { boardId: number; title: string; order?: number }) { return db.insert(stacks).values(stack).returning().get(); }

  getCards(boardId: number) { return db.select().from(cards).where(eq(cards.boardId, boardId)).all(); }
  getCard(id: number) { return db.select().from(cards).where(eq(cards.id, id)).get(); }
  createCard(card: { stackId: number; boardId: number; title: string; priority?: string; description?: string; dueDate?: string; assignee?: string; labels?: string }) {
    return db.insert(cards).values(card).returning().get();
  }
  updateCard(id: number, data: Partial<Card>) {
    db.update(cards).set(data).where(eq(cards.id, id)).run();
    return this.getCard(id);
  }
  deleteCard(id: number) { db.delete(cards).where(eq(cards.id, id)).run(); }

  getEmails(folder: string) { return db.select().from(emails).where(eq(emails.folder, folder)).all(); }
  getEmail(id: number) { return db.select().from(emails).where(eq(emails.id, id)).get(); }
  createEmail(email: { folder: string; from: string; fromEmail: string; to: string; subject: string; preview: string; body: string; receivedAt: string; isRead?: boolean; isStarred?: boolean; hasAttachment?: boolean }) {
    return db.insert(emails).values(email).returning().get();
  }
  updateEmail(id: number, data: Partial<Email>) {
    db.update(emails).set(data).where(eq(emails.id, id)).run();
    return this.getEmail(id);
  }
  deleteEmail(id: number) { db.delete(emails).where(eq(emails.id, id)).run(); }
  getEmailCounts() {
    const allEmails = db.select().from(emails).all();
    return {
      inbox: allEmails.filter(e => e.folder === "inbox" && !e.isRead).length,
      drafts: allEmails.filter(e => e.folder === "drafts").length,
      spam: allEmails.filter(e => e.folder === "spam").length,
    };
  }

}

export const storage = new DatabaseStorage();

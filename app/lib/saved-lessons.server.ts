import { and, desc, eq } from "drizzle-orm";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import type { Db } from "~/lib/comments.server";

// ─── Bookmarks and Notes ───
// A Student's private Bookmark and Note on a Lesson. One of each per Student
// per Lesson. See GLOSSARY.md for the language.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export const MAX_NOTE_LENGTH = 2000;

export type SavedLessonsFailure = { ok: false; error: string };

const LESSON_NOT_FOUND: SavedLessonsFailure = {
  ok: false,
  error: "Lesson not found.",
};

function lessonIsInCourse(db: Db, courseId: number, lessonId: number) {
  return !!db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(and(eq(lessons.id, lessonId), eq(modules.courseId, courseId)))
    .get();
}

export function getBookmark(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .get();
}

export function toggleBookmark(
  db: Db,
  userId: number,
  courseId: number,
  lessonId: number
): { ok: true; bookmarked: boolean } | SavedLessonsFailure {
  if (!lessonIsInCourse(db, courseId, lessonId)) return LESSON_NOT_FOUND;

  const removed = db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .run();
  if (removed.changes > 0) return { ok: true, bookmarked: false };

  // A double submit can race us here; the unique index makes the second
  // insert a no-op instead of an error.
  db.insert(bookmarks).values({ userId, lessonId }).onConflictDoNothing().run();
  return { ok: true, bookmarked: true };
}

export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

// Saves the Student's Note on a Lesson. An empty body removes the Note.
export function saveNote(
  db: Db,
  userId: number,
  courseId: number,
  lessonId: number,
  rawBody: string,
  now: Date
): { ok: true } | SavedLessonsFailure {
  const body = rawBody.trim();
  if (body.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: "That note is too long to save." };
  }

  if (!lessonIsInCourse(db, courseId, lessonId)) return LESSON_NOT_FOUND;

  if (body.length === 0) {
    db.delete(notes)
      .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
      .run();
    return { ok: true };
  }

  const timestamp = now.toISOString();
  db.insert(notes)
    .values({ userId, lessonId, body, createdAt: timestamp, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body, updatedAt: timestamp },
    })
    .run();
  return { ok: true };
}

const lessonRef = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

// Everything the Saved page lists, newest first.
export function getSavedLessons(db: Db, userId: number) {
  const savedBookmarks = db
    .select({ id: bookmarks.id, createdAt: bookmarks.createdAt, ...lessonRef })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt))
    .all();

  const savedNotes = db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRef,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt))
    .all();

  return { savedBookmarks, savedNotes };
}

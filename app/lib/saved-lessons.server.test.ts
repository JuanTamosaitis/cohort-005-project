import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  getBookmark,
  getNote,
  getSavedLessons,
  saveNote,
  toggleBookmark,
} from "./saved-lessons.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 10, 16, 12, 0, 0);
const LATER = new Date(2026, 10, 16, 13, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherCourseLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  const otherCourse = db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: "Sales copy.",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
  const otherModule = db
    .insert(schema.modules)
    .values({ courseId: otherCourse.id, title: "Other", position: 1 })
    .returning()
    .get();
  otherCourseLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: otherModule.id, title: "Other Lesson", position: 1 })
    .returning()
    .get().id;
});

describe("toggling a Bookmark", () => {
  it("bookmarks the Lesson, then removes the Bookmark on the second toggle", () => {
    expect(toggleBookmark(db, base.user.id, base.course.id, lessonId)).toEqual({
      ok: true,
      bookmarked: true,
    });
    expect(getBookmark(db, base.user.id, lessonId)).toBeDefined();

    expect(toggleBookmark(db, base.user.id, base.course.id, lessonId)).toEqual({
      ok: true,
      bookmarked: false,
    });
    expect(getBookmark(db, base.user.id, lessonId)).toBeUndefined();
  });

  it("refuses a Lesson that does not exist instead of throwing", () => {
    expect(toggleBookmark(db, base.user.id, base.course.id, 9999)).toEqual({
      ok: false,
      error: "Lesson not found.",
    });
  });

  it("refuses a Lesson from a different course", () => {
    expect(
      toggleBookmark(db, base.user.id, base.course.id, otherCourseLessonId)
    ).toEqual({ ok: false, error: "Lesson not found." });
    expect(getBookmark(db, base.user.id, otherCourseLessonId)).toBeUndefined();
  });
});

describe("saving a Note", () => {
  it("saves the Note trimmed, then updates the same row", () => {
    saveNote(db, base.user.id, base.course.id, lessonId, "  first  ", NOW);
    const first = getNote(db, base.user.id, lessonId)!;
    expect(first.body).toBe("first");

    saveNote(db, base.user.id, base.course.id, lessonId, "second", LATER);
    const second = getNote(db, base.user.id, lessonId)!;
    expect(second).toMatchObject({
      id: first.id,
      body: "second",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
  });

  it("removes the Note when the box is cleared", () => {
    saveNote(db, base.user.id, base.course.id, lessonId, "something", NOW);
    saveNote(db, base.user.id, base.course.id, lessonId, "   ", LATER);
    expect(getNote(db, base.user.id, lessonId)).toBeUndefined();
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const result = saveNote(
      db,
      base.user.id,
      base.course.id,
      lessonId,
      "a".repeat(2000),
      NOW
    );
    expect(result).toEqual({ ok: true });
  });

  it("refuses a Note over 2,000 characters", () => {
    const result = saveNote(
      db,
      base.user.id,
      base.course.id,
      lessonId,
      "a".repeat(2001),
      NOW
    );
    expect(result).toEqual({ ok: false, error: "That note is too long to save." });
    expect(getNote(db, base.user.id, lessonId)).toBeUndefined();
  });

  it("refuses a Lesson from a different course", () => {
    const result = saveNote(
      db,
      base.user.id,
      base.course.id,
      otherCourseLessonId,
      "sneaky",
      NOW
    );
    expect(result).toEqual({ ok: false, error: "Lesson not found." });
    expect(getNote(db, base.user.id, otherCourseLessonId)).toBeUndefined();
  });
});

describe("deleting a Lesson", () => {
  it("removes the Bookmarks and Notes on it", () => {
    toggleBookmark(db, base.user.id, base.course.id, lessonId);
    saveNote(db, base.user.id, base.course.id, lessonId, "mine", NOW);

    db.delete(schema.lessons).where(eq(schema.lessons.id, lessonId)).run();

    expect(getBookmark(db, base.user.id, lessonId)).toBeUndefined();
    expect(getNote(db, base.user.id, lessonId)).toBeUndefined();
  });
});

describe("the Saved page", () => {
  it("lists only the Student's own Bookmarks and Notes, with where they live", () => {
    const otherStudent = db
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();

    toggleBookmark(db, base.user.id, base.course.id, lessonId);
    saveNote(db, base.user.id, base.course.id, lessonId, "mine", NOW);
    toggleBookmark(db, otherStudent.id, base.course.id, lessonId);
    saveNote(db, otherStudent.id, base.course.id, lessonId, "theirs", NOW);

    const saved = getSavedLessons(db, base.user.id);

    expect(saved.savedBookmarks).toEqual([
      expect.objectContaining({
        lessonId,
        lessonTitle: "Lesson 1",
        moduleTitle: "Basics",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      }),
    ]);
    expect(saved.savedNotes).toEqual([
      expect.objectContaining({ lessonId, body: "mine" }),
    ]);
  });
});

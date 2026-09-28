import { getNextDueDate, isObligationDue } from "./obligationUtils";

test("monthly obligations retain their original due day after February", () => {
  expect(getNextDueDate("mensual", "2027-01-31", 31)).toBe("2027-02-28");
  expect(getNextDueDate("mensual", "2027-02-28", 31)).toBe("2027-03-31");
});

test("quincenal obligations alternate between two monthly due dates", () => {
  expect(getNextDueDate("quincenal", "2026-09-12", 12, 27, 1)).toBe("2026-09-27");
  expect(getNextDueDate("quincenal", "2026-09-27", 12, 27, 2)).toBe("2026-10-12");
});

test("quincenal second date clamps in short months without skipping payment two", () => {
  expect(getNextDueDate("quincenal", "2027-02-15", 15, 30, 1)).toBe("2027-02-28");
  expect(getNextDueDate("quincenal", "2027-02-28", 15, 30, 2)).toBe("2027-03-15");
});

test("current-month obligations count as pending before their due date", () => {
  expect(isObligationDue("2026-09-28", "2026-09-30")).toBe(true);
  expect(isObligationDue("2026-10-01", "2026-09-30")).toBe(false);
});
import {
  getDebtTotalAmount,
  getHomePendingObligations,
  getNextCardStatements,
  getNextDueDate,
  getUniqueDebtObligations,
  isObligationDue,
  sortObligationsByAmount,
} from "./obligationUtils";

test("monthly obligations retain their original due day after February", () => {
  expect(getNextDueDate("mensual", "2027-01-31", 31)).toBe("2027-02-28");
  expect(getNextDueDate("mensual", "2027-02-28", 31)).toBe("2027-03-31");
});

test("a late monthly payment can rebase the next due date to the payment day", () => {
  expect(getNextDueDate("mensual", "2026-10-24", 24)).toBe("2026-11-24");
  expect(getNextDueDate("mensual", "2026-01-31", 31)).toBe("2026-02-28");
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

test("home includes current-month obligations and only the next statement for each card", () => {
  const obligations = [
    { id: "november-statement-one", tarjetaId: "card-one", tipo: "pago_tarjeta", fechaProximoPago: "2026-11-20", activa: true },
    { id: "december-statement-one", tarjetaId: "card-one", tipo: "pago_tarjeta", fechaProximoPago: "2026-12-20", activa: true },
    { id: "november-statement-two", tarjetaId: "card-two", tipo: "pago_tarjeta", fechaProximoPago: "2026-11-15", activa: true },
    { id: "december-statement-two", tarjetaId: "card-two", tipo: "pago_tarjeta", fechaProximoPago: "2026-12-15", activa: true },
    { id: "next-month-bill", tipo: "servicio", fechaProximoPago: "2026-11-10", activa: true },
    { id: "current-bill", tipo: "servicio", fechaProximoPago: "2026-10-30", activa: true },
    { id: "current-statement", tipo: "pago_tarjeta", fechaProximoPago: "2026-10-25", activa: true },
    { id: "previous-overdue", tipo: "servicio", fechaProximoPago: "2026-09-30", activa: true },
    { id: "paid-statement", tipo: "pago_tarjeta", fechaProximoPago: "2026-10-20", activa: false },
  ];

  expect(getHomePendingObligations(obligations, "2026-10-24").map(({ id }) => id)).toEqual([
    "current-statement",
    "current-bill",
    "november-statement-two",
    "november-statement-one",
  ]);
});

test("debt obligations are deduplicated using the latest payment progress", () => {
  const obligations = [
    { id: "debt-first-installment", deudaId: "debt-1", proximoPagoNumero: 1, activa: true },
    { id: "debt-third-installment", deudaId: "debt-1", proximoPagoNumero: 3, activa: true },
    { id: "other-debt", deudaId: "debt-2", proximoPagoNumero: 1, activa: true },
    { id: "regular", activa: true },
  ];

  expect(getUniqueDebtObligations(obligations).map(({ id }) => id)).toEqual([
    "regular",
    "debt-third-installment",
    "other-debt",
  ]);
});

test("only the next pending statement for each card is listed", () => {
  const obligations = [
    { id: "november", tarjetaId: "card-1", tipo: "pago_tarjeta", fechaProximoPago: "2026-11-15", activa: true },
    { id: "december", tarjetaId: "card-1", tipo: "pago_tarjeta", fechaProximoPago: "2026-12-15", activa: true },
    { id: "january", tarjetaId: "card-1", tipo: "pago_tarjeta", fechaProximoPago: "2027-01-15", activa: true },
    { id: "other-card", tarjetaId: "card-2", tipo: "pago_tarjeta", fechaProximoPago: "2026-11-20", activa: true },
    { id: "paid", tarjetaId: "card-2", tipo: "pago_tarjeta", fechaProximoPago: "2026-11-10", activa: false },
  ];

  expect(getNextCardStatements(obligations).map(({ id }) => id)).toEqual([
    "november",
    "other-card",
  ]);
});

test("debt totals use the full installment schedule and sort obligations by amount", () => {
  const obligations = [
    { id: "regular", valor: 50000 },
    { id: "debt", deudaId: "debt-1", valor: 10000, cuotas: 3, valoresCuota: [10000, 10000, 10000] },
    { id: "card", tipo: "pago_tarjeta", valor: 200000, montoPendiente: 75000 },
  ];

  expect(getDebtTotalAmount(obligations[1])).toBe(30000);
  expect(sortObligationsByAmount(obligations).map(({ id }) => id)).toEqual([
    "card",
    "regular",
    "debt",
  ]);
});
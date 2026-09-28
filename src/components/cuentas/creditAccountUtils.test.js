import { applyCreditPayment, applyCreditPurchase, getCreditStatementDates } from "./creditAccountUtils";

const creditAccount = {
  tipoCuenta: "credito",
  limiteCredito: 1000,
  saldo: 700,
  deudaActual: 300,
};

test("a credit purchase decreases available limit and increases debt", () => {
  expect(applyCreditPurchase(creditAccount, 250)).toEqual({
    saldo: 450,
    deudaActual: 550,
  });
});

test("a purchase cannot exceed the available credit", () => {
  expect(() => applyCreditPurchase(creditAccount, 701)).toThrow("CREDIT_LIMIT_EXCEEDED");
});

test("a card payment decreases debt and restores available limit", () => {
  expect(applyCreditPayment(creditAccount, 200)).toEqual({
    saldo: 900,
    deudaActual: 100,
  });
});

test("a card payment cannot exceed the outstanding debt", () => {
  expect(() => applyCreditPayment(creditAccount, 301)).toThrow("PAYMENT_EXCEEDS_CREDIT_DEBT");
});

test("the current cutoff produces the next month's payment date", () => {
  const dates = getCreditStatementDates(
    { fechaCorte: 15, fechaLimitePago: 4 },
    new Date(2026, 8, 28)
  );

  expect(dates.cutoffDate.getFullYear()).toBe(2026);
  expect(dates.cutoffDate.getMonth()).toBe(8);
  expect(dates.cutoffDate.getDate()).toBe(15);
  expect(dates.paymentDate.getMonth()).toBe(9);
  expect(dates.paymentDate.getDate()).toBe(4);
});

test("the next card payment skips an already elapsed cycle", () => {
  const dates = getCreditStatementDates(
    { fechaCorte: 3, fechaLimitePago: 20 },
    new Date(2026, 8, 28)
  );

  expect(dates.cutoffDate.getMonth()).toBe(9);
  expect(dates.cutoffDate.getDate()).toBe(3);
  expect(dates.paymentDate.getMonth()).toBe(9);
  expect(dates.paymentDate.getDate()).toBe(20);
});

test("credit dates clamp to the last day of short months", () => {
  const dates = getCreditStatementDates(
    { fechaCorte: 31, fechaLimitePago: 4 },
    new Date(2027, 1, 5)
  );

  expect(dates.cutoffDate.getMonth()).toBe(1);
  expect(dates.cutoffDate.getDate()).toBe(28);
  expect(dates.paymentDate.getMonth()).toBe(2);
  expect(dates.paymentDate.getDate()).toBe(4);
});

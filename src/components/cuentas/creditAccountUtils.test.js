import {
  addCreditInstallmentToStatement,
  applyCreditAdvance,
  applyCreditPayment,
  applyCreditPurchase,
  getCreditInstallmentAmounts,
  getCreditInstallmentSchedule,
  getCreditMovementStatementAmount,
  getCreditStatementDates,
  getCreditStatementForPurchase,
  getCreditUsageMetrics,
} from "./creditAccountUtils";

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

test("credit purchases respect the configured maximum usage percentage", () => {
  const limitedAccount = {
    ...creditAccount,
    limiteCredito: 1000,
    deudaActual: 350,
    saldo: 650,
    porcentajeUsoMaximo: 40,
  };

  expect(getCreditUsageMetrics(limitedAccount)).toEqual({
    usagePercentage: 40,
    allowedDebt: 400,
    remainingToSpend: 50,
    reservedAmount: 600,
  });
  expect(applyCreditPurchase(limitedAccount, 50).deudaActual).toBe(400);
  expect(() => applyCreditPurchase(limitedAccount, 51)).toThrow("CREDIT_USAGE_LIMIT_EXCEEDED");
});

test("credit accounts without a usage percentage retain the full limit", () => {
  expect(getCreditUsageMetrics(creditAccount).remainingToSpend).toBe(700);
});

test("a credit advance adds its configured charge to the card debt", () => {
  expect(applyCreditAdvance({ ...creditAccount, cargoAvance: 25 }, 250)).toEqual({
    saldo: 425,
    deudaActual: 575,
  });
});

test("a credit advance cannot exceed the available credit after its charge", () => {
  expect(() => applyCreditAdvance({ ...creditAccount, cargoAvance: 25 }, 700)).toThrow("CREDIT_LIMIT_EXCEEDED");
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

test("a purchase before the cutoff belongs to the upcoming payment", () => {
  const statement = getCreditStatementForPurchase(
    { fechaCorte: 15, fechaLimitePago: 4 },
    new Date(2026, 9, 10)
  );

  expect(statement.cutoffDate).toEqual(new Date(2026, 9, 15));
  expect(statement.paymentDate).toEqual(new Date(2026, 10, 4));
});

test("a purchase after cutoff is assigned to the following statement", () => {
  const statement = getCreditStatementForPurchase(
    { fechaCorte: 15, fechaLimitePago: 4 },
    new Date(2026, 9, 16)
  );

  expect(statement.cutoffDate).toEqual(new Date(2026, 10, 15));
  expect(statement.paymentDate).toEqual(new Date(2026, 11, 4));
});

test("the September 21 to October 20 cycle is grouped into the October statement", () => {
  const statement = getCreditStatementForPurchase(
    { fechaCorte: 20, fechaLimitePago: 4 },
    new Date(2026, 8, 21)
  );
  const lastDayInCycle = getCreditStatementForPurchase(
    { fechaCorte: 20, fechaLimitePago: 4 },
    new Date(2026, 9, 20)
  );

  expect(statement.startDate).toEqual(new Date(2026, 8, 21));
  expect(statement.cutoffDate).toEqual(new Date(2026, 9, 20));
  expect(statement.paymentDate).toEqual(new Date(2026, 10, 4));
  expect(lastDayInCycle.cutoffDate).toEqual(statement.cutoffDate);
});

test("a purchase on cutoff day belongs to that cutoff", () => {
  const statement = getCreditStatementForPurchase(
    { fechaCorte: 15, fechaLimitePago: 4 },
    new Date(2026, 9, 15)
  );

  expect(statement.cutoffDate).toEqual(new Date(2026, 9, 15));
});

test("a purchase the day before cutoff belongs to the statement ending the next day", () => {
  const statement = getCreditStatementForPurchase(
    { fechaCorte: 18, fechaLimitePago: 5 },
    new Date(2026, 9, 17, 23, 59)
  );
  const schedule = getCreditInstallmentSchedule(
    { fechaCorte: 18, fechaLimitePago: 5 },
    12000,
    1,
    new Date(2026, 9, 17, 23, 59)
  );

  expect(statement.cutoffDate).toEqual(new Date(2026, 9, 18));
  expect(schedule[0].cutoffDate).toEqual(new Date(2026, 9, 18));
});

test("purchase statement dates clamp cutoffs in short months", () => {
  const statement = getCreditStatementForPurchase(
    { fechaCorte: 31, fechaLimitePago: 4 },
    new Date(2027, 1, 28)
  );

  expect(statement.cutoffDate).toEqual(new Date(2027, 1, 28));
  expect(statement.paymentDate).toEqual(new Date(2027, 2, 4));
});

test("credit installment schedule adds one monthly statement for each installment", () => {
  const schedule = getCreditInstallmentSchedule(
    { fechaCorte: 15, fechaLimitePago: 4 },
    10000,
    3,
    new Date(2026, 9, 10)
  );

  expect(schedule.map(({ amount, cutoffDate, paymentDate }) => ({
    amount,
    cutoffDate,
    paymentDate,
  }))).toEqual([
    { amount: 3334, cutoffDate: new Date(2026, 9, 15), paymentDate: new Date(2026, 10, 4) },
    { amount: 3333, cutoffDate: new Date(2026, 10, 15), paymentDate: new Date(2026, 11, 4) },
    { amount: 3333, cutoffDate: new Date(2026, 11, 15), paymentDate: new Date(2027, 0, 4) },
  ]);
});

test("card advances stay whole in their recorded statement even with an installments field", () => {
  const account = { fechaCorte: 18, fechaLimitePago: 5 };
  const advance = {
    tipo: "credito_avance",
    valor: 106700,
    cuotas: 36,
    fechaCorteTarjeta: "2026-10-18",
  };

  expect(getCreditMovementStatementAmount(
    account,
    advance,
    new Date(2026, 9, 17, 21, 50),
    "2026-10-18"
  )).toBe(106700);
  expect(getCreditMovementStatementAmount(
    account,
    advance,
    new Date(2026, 9, 17, 21, 50),
    "2026-11-18"
  )).toBe(0);
});

test("credit installment amounts always sum to the purchase total", () => {
  const schedule = getCreditInstallmentSchedule(
    { fechaCorte: 31, fechaLimitePago: 4 },
    100,
    6,
    new Date(2027, 0, 20)
  );

  expect(schedule.reduce((total, installment) => total + installment.amount, 0)).toBe(100);
  expect(schedule[0].amount).toBe(17);
  expect(schedule[5].amount).toBe(16);
});

test("credit installment amounts show each monthly amount and distribute remaining units", () => {
  expect(getCreditInstallmentAmounts(100000, 3)).toEqual([33334, 33333, 33333]);
  expect(getCreditInstallmentAmounts(300000, 3)).toEqual([100000, 100000, 100000]);
});

test("a credit installment adds to an existing statement's total and pending amount", () => {
  expect(addCreditInstallmentToStatement({
    valor: 125000,
    montoPendiente: 45000,
  }, 50000)).toEqual({
    valor: 175000,
    montoPendiente: 95000,
    activa: true,
    anulada: false,
  });
});

test("a statement keeps the financed installment link for payment synchronization", () => {
  const installment = {
    deudaId: "purchase-debt",
    obligacionId: "purchase-obligation",
    numero: 1,
    valor: 50000,
    pagada: false,
  };

  expect(addCreditInstallmentToStatement({
    valor: 60000,
    montoPendiente: 60000,
    cuotasCompra: [{ deudaId: "another-debt", numero: 1, valor: 10000, pagada: false }],
  }, 50000, installment)).toEqual({
    valor: 110000,
    montoPendiente: 110000,
    activa: true,
    anulada: false,
    cuotasCompra: [
      { deudaId: "another-debt", numero: 1, valor: 10000, pagada: false },
      installment,
    ],
  });
});

test("two installments add only the first installment to the current statement", () => {
  const schedule = getCreditInstallmentSchedule(
    { fechaCorte: 15, fechaLimitePago: 4 },
    100000,
    2,
    new Date(2026, 9, 10)
  );
  const currentStatement = addCreditInstallmentToStatement({ valor: 60000, montoPendiente: 60000 },
    schedule[0].amount);
  const nextStatement = addCreditInstallmentToStatement(null, schedule[1].amount);

  expect(schedule.map(({ amount }) => amount)).toEqual([50000, 50000]);
  expect(currentStatement.valor).toBe(110000);
  expect(currentStatement.montoPendiente).toBe(110000);
  expect(nextStatement.valor).toBe(50000);
});

test("a credit installment activates a previously settled statement", () => {
  expect(addCreditInstallmentToStatement({
    valor: 80000,
    montoPendiente: 0,
    activa: false,
    anulada: true,
  }, 20000)).toEqual({
    valor: 100000,
    montoPendiente: 20000,
    activa: true,
    anulada: false,
  });
});

test("rejects more installments than purchase units", () => {
  expect(() => getCreditInstallmentSchedule(
    { fechaCorte: 15, fechaLimitePago: 4 },
    2,
    3
  )).toThrow("INVALID_CREDIT_INSTALLMENTS");
});

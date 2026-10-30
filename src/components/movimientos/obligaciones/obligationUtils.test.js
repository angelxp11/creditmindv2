import {
  getDebtTotalAmount,
  getHomePendingObligations,
  getNextCardStatements,
  getNextDueDate,
  getMonthlyCommitmentSummary,
  getObligationIncomePlan,
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

test("the 30th paycheck also covers the next month's days 1 to 14", () => {
  const plan = getObligationIncomePlan(
    [
      { id: "internet", nombre: "Internet", valor: 80000, frecuencia: "mensual", diaVencimiento: 9, fechaProximoPago: "2026-11-09", activa: true },
      { id: "rent", nombre: "Arriendo", valor: 700000, frecuencia: "mensual", diaVencimiento: 1, fechaProximoPago: "2026-11-01", activa: true },
      { id: "insurance", nombre: "Seguro", valor: 33500, frecuencia: "mensual", diaVencimiento: 15, fechaProximoPago: "2026-11-15", activa: true },
      { id: "marketplace", nombre: "Mercado Pago", valor: 216650, frecuencia: "mensual", diaVencimiento: 15, fechaProximoPago: "2026-11-15", activa: true },
      { id: "gas", nombre: "Gas", valor: 40000, frecuencia: "mensual", diaVencimiento: 30, fechaProximoPago: "2026-11-30", activa: true },
      { id: "internet-december", nombre: "Internet diciembre", valor: 50000, frecuencia: "mensual", diaVencimiento: 5, fechaProximoPago: "2026-12-05", activa: true },
      { id: "insurance-december", nombre: "Seguro diciembre", valor: 25000, frecuencia: "mensual", diaVencimiento: 14, fechaProximoPago: "2026-12-14", activa: true },
      { id: "rent-december", nombre: "Arriendo diciembre", valor: 700000, frecuencia: "mensual", diaVencimiento: 15, fechaProximoPago: "2026-12-15", activa: true },
    ],
    [{
      id: "salary",
      nombre: "Nómina",
      valor: 2500000,
      frecuencia: "quincenal",
      fechaProximoPago: "2026-10-30",
      diaVencimiento: 15,
      diaSegundoPago: 30,
      proximoPagoNumero: 2,
      activa: true,
    }],
    "2026-10-30"
  );

  expect(plan.startDate).toBe("2026-11-01");
  expect(plan.endDate).toBe("2026-12-14");
  expect(plan.allocations).toHaveLength(3);
  expect(plan.allocations[0].date).toBe("2026-10-30");
  expect(plan.allocations[0].obligations.map(({ id }) => id)).toEqual(["rent", "internet"]);
  expect(plan.allocations[0].shortfall).toBe(0);
  expect(plan.allocations[1].date).toBe("2026-11-15");
  expect(plan.allocations[1].obligations.map(({ id }) => id)).toEqual([
    "insurance",
    "marketplace",
  ]);
  expect(plan.allocations[2].date).toBe("2026-11-30");
  expect(plan.allocations[2].obligations.map(({ id }) => id)).toEqual([
    "gas",
    "rent",
    "internet-december",
    "internet",
    "insurance-december",
  ]);
  expect(plan.allocations.flatMap(({ obligations }) => obligations).map(({ id }) => id))
    .not.toContain("rent-december");
});

test("the 30th payday receives obligations due on the 30th instead of the 15th payday", () => {
  const plan = getObligationIncomePlan(
    [
      { id: "phone", nombre: "Teléfono", valor: 70000, frecuencia: "mensual", diaVencimiento: 15, fechaProximoPago: "2026-11-15", activa: true },
      { id: "water", nombre: "Agua", valor: 60000, frecuencia: "mensual", diaVencimiento: 28, fechaProximoPago: "2026-11-28", activa: true },
      { id: "gas", nombre: "Gas", valor: 40000, frecuencia: "mensual", diaVencimiento: 30, fechaProximoPago: "2026-11-30", activa: true },
    ],
    [{
      id: "salary",
      nombre: "Nómina",
      valor: 2500000,
      frecuencia: "quincenal",
      fechaProximoPago: "2026-10-30",
      diaVencimiento: 15,
      diaSegundoPago: 30,
      proximoPagoNumero: 1,
      activa: true,
    }],
    "2026-10-30"
  );

  expect(plan.allocations.map(({ date, obligations }) => ({
    date,
    obligations: obligations.map(({ id }) => id),
  }))).toEqual([
    { date: "2026-11-15", obligations: ["phone", "water"] },
    { date: "2026-11-30", obligations: ["gas"] },
  ]);
});

test("a day-30 obligation is not assigned to the 15th if no day-30 income is scheduled", () => {
  const plan = getObligationIncomePlan(
    [{
      id: "gas",
      nombre: "Gas",
      valor: 40000,
      frecuencia: "mensual",
      diaVencimiento: 30,
      fechaProximoPago: "2026-11-30",
      activa: true,
    }],
    [{
      id: "salary",
      nombre: "Nómina",
      valor: 800000,
      frecuencia: "mensual",
      fechaProximoPago: "2026-11-15",
      diaVencimiento: 15,
      activa: true,
    }],
    "2026-10-30"
  );

  expect(plan.allocations).toHaveLength(0);
  expect(plan.unassigned.map(({ id }) => id)).toEqual(["gas"]);
});

test("the plan does not assign future obligations to an income date that has already passed", () => {
  const plan = getObligationIncomePlan(
    [{
      id: "internet",
      nombre: "Internet",
      valor: 50000,
      frecuencia: "mensual",
      diaVencimiento: 5,
      fechaProximoPago: "2026-11-05",
      activa: true,
    }],
    [{
      id: "salary",
      nombre: "Nómina",
      valor: 800000,
      frecuencia: "quincenal",
      fechaProximoPago: "2026-10-30",
      diaVencimiento: 15,
      diaSegundoPago: 30,
      proximoPagoNumero: 2,
      activa: true,
    }],
    "2026-10-31",
    true
  );

  expect(plan.allocations.map(({ date }) => date)).toEqual(["2026-11-15", "2026-11-30"]);
  expect(plan.unassigned.map(({ id }) => id)).toEqual(["internet"]);
  expect(plan.allocations[0].carryIn).toBe(0);
});

test("paid obligations do not appear in the income plan", () => {
  const plan = getObligationIncomePlan(
    [
      { id: "paid-debt", nombre: "Deuda saldada", valor: 50000, fechaProximoPago: "2026-11-05", activa: true, deudaPagada: true },
      { id: "paid-card", nombre: "Extracto pagado", tipo: "pago_tarjeta", valor: 50000, montoPendiente: 0, fechaProximoPago: "2026-11-05", activa: true },
      { id: "paused", nombre: "Obligación pausada", valor: 50000, fechaProximoPago: "2026-11-05", activa: false },
    ],
    [{
      id: "salary",
      nombre: "Nómina",
      valor: 800000,
      frecuencia: "quincenal",
      fechaProximoPago: "2026-10-30",
      diaVencimiento: 15,
      diaSegundoPago: 30,
      proximoPagoNumero: 2,
      activa: true,
    }],
    "2026-10-30"
  );

  expect(plan.allocations).toHaveLength(0);
  expect(plan.unassigned).toHaveLength(0);
});

test("compensation carries leftover from the previous paycheck to cover the next period", () => {
  const obligations = [
    { id: "early", nombre: "Servicios", valor: 300000, frecuencia: "mensual", diaVencimiento: 5, fechaProximoPago: "2026-11-05", activa: true },
    { id: "mid", nombre: "Arriendo", valor: 900000, frecuencia: "mensual", diaVencimiento: 20, fechaProximoPago: "2026-11-20", activa: true },
    { id: "late", nombre: "Gas", valor: 100000, frecuencia: "mensual", diaVencimiento: 30, fechaProximoPago: "2026-11-30", activa: true },
  ];
  const incomes = [{
    id: "salary",
    nombre: "Nómina",
    valor: 800000,
    frecuencia: "quincenal",
    fechaProximoPago: "2026-10-30",
    diaVencimiento: 15,
    diaSegundoPago: 30,
    proximoPagoNumero: 2,
    activa: true,
  }];
  const planWithoutCompensation = getObligationIncomePlan(
    obligations,
    incomes,
    "2026-10-30"
  );
  const planWithCompensation = getObligationIncomePlan(
    obligations,
    incomes,
    "2026-10-30",
    true
  );

  expect(planWithoutCompensation.allocations.find(({ date }) => date === "2026-11-15").shortfall).toBe(100000);
  expect(planWithCompensation.allocations.map(({ date, carryIn, remainingIncome, shortfall }) => ({
    date,
    carryIn,
    remainingIncome,
    shortfall,
  }))).toEqual([
    { date: "2026-10-30", carryIn: 0, remainingIncome: 500000, shortfall: 0 },
    { date: "2026-11-15", carryIn: 500000, remainingIncome: 400000, shortfall: 0 },
    { date: "2026-11-30", carryIn: 400000, remainingIncome: 800000, shortfall: 0 },
  ]);
});

test("income allocation prioritizes nearest due dates when that pay is insufficient", () => {
  const plan = getObligationIncomePlan(
    [
      { id: "internet", nombre: "Internet", valor: 80000, frecuencia: "mensual", diaVencimiento: 9, fechaProximoPago: "2026-11-09", activa: true },
      { id: "phone", nombre: "Teléfono", valor: 70000, frecuencia: "mensual", diaVencimiento: 10, fechaProximoPago: "2026-11-10", activa: true },
    ],
    [{
      id: "salary",
      nombre: "Nómina",
      valor: 100000,
      frecuencia: "quincenal",
      fechaProximoPago: "2026-10-30",
      diaVencimiento: 14,
      diaSegundoPago: 30,
      proximoPagoNumero: 2,
      activa: true,
    }],
    "2026-10-30"
  );

  expect(plan.allocations[0].obligations.map(({ id, coveredAmount, shortfall }) => ({
    id,
    coveredAmount,
    shortfall,
  }))).toEqual([
    { id: "internet", coveredAmount: 80000, shortfall: 0 },
    { id: "phone", coveredAmount: 20000, shortfall: 50000 },
  ]);
  expect(plan.allocations[0].shortfall).toBe(50000);
});

test("monthly commitment normalizes quincenal obligations and income to two payments", () => {
  const summary = getMonthlyCommitmentSummary(
    [
      { id: "rent", nombre: "Arriendo", valor: 700000, frecuencia: "mensual", activa: true },
      { id: "food", nombre: "Mercado", valor: 200000, frecuencia: "quincenal", activa: true },
      { id: "debt", nombre: "Cuota", deudaId: "debt-1", valoresCuota: [50000, 50000], proximoPagoNumero: 1, frecuencia: "mensual", activa: true },
      { id: "paused", nombre: "Pausada", valor: 100000, frecuencia: "mensual", activa: false },
    ],
    [
      { id: "salary", nombre: "Nómina", valor: 800000, frecuencia: "quincenal", activa: true },
      { id: "other", nombre: "Otro ingreso", valor: 100000, frecuencia: "mensual", activa: true },
    ]
  );

  expect(summary.monthlyObligations).toBe(1150000);
  expect(summary.monthlyIncome).toBe(1700000);
  expect(summary.remaining).toBe(550000);
  expect(summary.items.map(({ id }) => id)).toEqual(["rent", "food", "debt"]);
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
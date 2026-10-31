const parseDateOnly = (value) => {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

export const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateForDay = (year, month, requestedDay) => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return getLocalDateString(new Date(year, month, Math.min(Number(requestedDay), lastDay)));
};

export const getNextDueDate = (frequency, currentDate, dueDay, secondDueDay, paymentNumber = 1) => {
  const date = parseDateOnly(currentDate);
  if (!date) return getLocalDateString();

  if (frequency === "quincenal") {
    if (!secondDueDay) {
      date.setDate(date.getDate() + 15);
      return getLocalDateString(date);
    }

    if (Number(paymentNumber) === 1) {
      return getDateForDay(date.getFullYear(), date.getMonth(), secondDueDay);
    }

    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return getDateForDay(nextMonth.getFullYear(), nextMonth.getMonth(), dueDay);
  }

  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return getDateForDay(nextMonth.getFullYear(), nextMonth.getMonth(), Number(dueDay) || date.getDate());
};

const getPreviousIncomeDate = (income, dateValue, paymentNumber) => {
  const date = parseDateOnly(dateValue);
  if (!date) return null;

  if (income.frecuencia === "quincenal") {
    if (Number(paymentNumber) === 2) {
      return getDateForDay(date.getFullYear(), date.getMonth(), income.diaVencimiento);
    }

    const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    return getDateForDay(
      previousMonth.getFullYear(),
      previousMonth.getMonth(),
      income.diaSegundoPago || income.diaVencimiento
    );
  }

  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return getDateForDay(
    previousMonth.getFullYear(),
    previousMonth.getMonth(),
    income.diaVencimiento || date.getDate()
  );
};

const getScheduledObligationAmount = (obligation) => {
  if (obligation.tipo === "pago_tarjeta") {
    return Number(obligation.montoPendiente ?? obligation.valor ?? 0);
  }
  if (obligation.deudaId && Array.isArray(obligation.valoresCuota)) {
    const installmentIndex = Math.max(0, Number(obligation.proximoPagoNumero || 1) - 1);
    return Number(obligation.valoresCuota[installmentIndex] || 0);
  }
  if (obligation.deudaId && Number.isFinite(Number(obligation.deudaRestante))) {
    return Math.min(Number(obligation.valor || 0), Number(obligation.deudaRestante));
  }
  return Number(obligation.valor || 0);
};

export const getDebtInstallmentAmounts = (
  remainingBalance,
  installmentAmount,
  paidInstallments = 0,
  previousInstallments = []
) => {
  if (
    !Number.isSafeInteger(remainingBalance) || remainingBalance <= 0 ||
    !Number.isSafeInteger(installmentAmount) || installmentAmount <= 0
  ) {
    throw new Error("INVALID_DEBT_INSTALLMENT_PLAN");
  }

  const paidCount = Math.max(0, Math.floor(Number(paidInstallments) || 0));
  const amounts = previousInstallments.slice(0, paidCount).map(Number);
  while (amounts.length < paidCount) amounts.push(installmentAmount);

  const remainingInstallmentCount = Math.ceil(remainingBalance / installmentAmount);
  for (let index = 0; index < remainingInstallmentCount; index += 1) {
    amounts.push(index === remainingInstallmentCount - 1
      ? remainingBalance - installmentAmount * index
      : installmentAmount);
  }

  return amounts;
};

export const getDebtNextInstallmentNumber = (installmentAmounts, remainingBalance) => {
  if (!Array.isArray(installmentAmounts) || installmentAmounts.length === 0) return 1;
  const total = installmentAmounts.reduce((sum, amount) => sum + Number(amount || 0), 0);
  const paidAmount = Math.max(0, total - Number(remainingBalance || 0));
  let cumulativeAmount = 0;
  const nextIndex = installmentAmounts.findIndex((amount) => {
    cumulativeAmount += Number(amount || 0);
    return cumulativeAmount > paidAmount;
  });
  return nextIndex < 0 ? installmentAmounts.length : nextIndex + 1;
};

const getScheduledObligationOccurrences = (obligation, today, throughDate) => {
  let date = String(obligation.fechaProximoPago || "").slice(0, 10);
  const frequency = obligation.frecuencia === "quincenal" ? "quincenal" : "mensual";
  const firstDay = Number(obligation.diaVencimiento) || Number(date.slice(-2));
  const secondDay = Number(obligation.diaSegundoPago || firstDay);
  let paymentNumber = Number(obligation.proximoPagoNumero || 1) === 2 ? 2 : 1;
  const firstInstallmentNumber = Number(obligation.proximoPagoNumero || 1);
  const installmentLimit = obligation.deudaId && (obligation.cuotas || obligation.valoresCuota?.length)
    ? Number(obligation.cuotas || obligation.valoresCuota.length)
    : Infinity;
  let remainingDebt = Number(obligation.deudaRestante);
  const occurrences = [];

  if (!parseDateOnly(date)) return occurrences;

  for (let index = 0; index < 12 && date <= throughDate; index += 1) {
    const installmentNumber = firstInstallmentNumber + index;
    if (date >= today && installmentNumber <= installmentLimit) {
      const plannedAmount = obligation.deudaId && Array.isArray(obligation.valoresCuota)
        ? Number(obligation.valoresCuota[installmentNumber - 1] || 0)
        : getScheduledObligationAmount(obligation);
      const occurrenceAmount = Number.isFinite(remainingDebt)
        ? Math.min(plannedAmount, remainingDebt)
        : plannedAmount;
      if (Number.isSafeInteger(occurrenceAmount) && occurrenceAmount > 0) {
        occurrences.push({
          ...obligation,
          planId: `${obligation.id}-${date}`,
          fechaProximoPago: date,
          plannedAmount: occurrenceAmount,
        });
        if (Number.isFinite(remainingDebt)) remainingDebt -= occurrenceAmount;
      }
    }

    if (obligation.tipo === "pago_tarjeta") break;
    date = getNextDueDate(frequency, date, firstDay, secondDay, paymentNumber);
    paymentNumber = frequency === "quincenal" && paymentNumber === 1 ? 2 : 1;
  }

  return occurrences;
};

const getIncomeOccurrences = (income, throughDate) => {
  const frequency = income.frecuencia === "quincenal" ? "quincenal" : "mensual";
  let date = String(income.fechaProximoPago || "").slice(0, 10);
  const firstDay = Number(income.diaVencimiento) || Number(date.slice(-2));
  const secondDay = Number(income.diaSegundoPago || firstDay);
  let paymentNumber = Number(income.proximoPagoNumero || 1) === 2 ? 2 : 1;
  const dates = new Set();

  if (!parseDateOnly(date)) return [];

  for (let index = 0; index < 3; index += 1) {
    const previousDate = getPreviousIncomeDate(income, date, paymentNumber);
    if (!previousDate) break;
    dates.add(previousDate);
    date = previousDate;
    paymentNumber = frequency === "quincenal" && paymentNumber === 2 ? 1 : 2;
  }

  date = String(income.fechaProximoPago).slice(0, 10);
  paymentNumber = Number(income.proximoPagoNumero || 1) === 2 ? 2 : 1;
  for (let index = 0; index < 8 && date <= throughDate; index += 1) {
    dates.add(date);
    date = getNextDueDate(frequency, date, firstDay, secondDay, paymentNumber);
    paymentNumber = frequency === "quincenal" && paymentNumber === 1 ? 2 : 1;
  }

  return [...dates].sort();
};

export const getObligationIncomePlan = (
  obligations,
  incomes,
  today = getLocalDateString(),
  compensate = false
) => {
  const currentDate = parseDateOnly(today);
  const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 14);
  const startDateString = getLocalDateString(startDate);
  const throughDate = getLocalDateString(endDate);
  const incomeByDate = new Map();

  incomes
    .filter((income) => income.activa && income.fechaProximoPago)
    .forEach((income) => {
      const occurrences = getIncomeOccurrences(income, throughDate);
      occurrences
        .filter((date) => date >= today && date <= throughDate)
        .forEach((date) => {
        const scheduled = incomeByDate.get(date) || { date, incomeNames: [], amount: 0 };
        scheduled.incomeNames.push(income.nombre);
        scheduled.amount += Number(income.valor || 0);
        incomeByDate.set(date, scheduled);
      });
    });

  const incomeDates = [...incomeByDate.keys()].sort();
  const allocationsByDate = new Map();
  const unassigned = [];

  if (compensate) {
    incomeDates.forEach((date) => {
      allocationsByDate.set(date, {
        ...incomeByDate.get(date),
        obligations: [],
      });
    });
  }

  obligations
    .filter((obligation) =>
      obligation.activa &&
      !obligation.anulada &&
      !obligation.deudaPagada &&
      (obligation.tipo !== "pago_tarjeta" ||
        Number(obligation.montoPendiente ?? obligation.valor ?? 0) > 0) &&
      obligation.fechaProximoPago
    )
    .flatMap((obligation) => getScheduledObligationOccurrences(obligation, startDateString, throughDate))
    .sort((first, second) => String(first.fechaProximoPago).localeCompare(String(second.fechaProximoPago)))
    .forEach((obligation) => {
      const incomeDate = incomeDates
        .filter((date) => date <= obligation.fechaProximoPago)
        .pop();
      if (!incomeDate) {
        unassigned.push(obligation);
        return;
      }

      const plan = allocationsByDate.get(incomeDate) || {
        ...incomeByDate.get(incomeDate),
        obligations: [],
      };
      plan.obligations.push(obligation);
      allocationsByDate.set(incomeDate, plan);
    });

  const allocations = [...allocationsByDate.values()].sort((first, second) =>
    first.date.localeCompare(second.date)
  );

  let carriedAmount = 0;
  allocations.forEach((plan) => {
    plan.carryIn = compensate ? carriedAmount : 0;
    plan.availableAmount = plan.amount + plan.carryIn;
    let remainingIncome = plan.availableAmount;
    plan.obligations.forEach((obligation) => {
      obligation.coveredAmount = Math.min(obligation.plannedAmount, remainingIncome);
      obligation.shortfall = obligation.plannedAmount - obligation.coveredAmount;
      remainingIncome -= obligation.coveredAmount;
    });
    plan.remainingIncome = remainingIncome;
    plan.carryOut = compensate ? remainingIncome : 0;
    carriedAmount = plan.carryOut;
    plan.shortfall = plan.obligations.reduce((total, obligation) =>
      total + obligation.shortfall, 0
    );
  });

  return { allocations, unassigned, startDate: startDateString, endDate: throughDate };
};

export const getMonthlyCommitmentSummary = (obligations, incomes) => {
  const activeObligations = obligations.filter((obligation) =>
    obligation.activa &&
    !obligation.anulada &&
    !obligation.deudaPagada
  );
  const items = activeObligations
    .map((obligation) => {
      const amount = getScheduledObligationAmount(obligation);
      const frequencyMultiplier = obligation.frecuencia === "quincenal" ? 2 : 1;
      return {
        ...obligation,
        monthlyAmount: amount * frequencyMultiplier,
      };
    })
    .filter((obligation) =>
      Number.isSafeInteger(obligation.monthlyAmount) && obligation.monthlyAmount > 0
    )
    .sort((first, second) => second.monthlyAmount - first.monthlyAmount);
  const monthlyObligations = items.reduce((total, obligation) =>
    total + obligation.monthlyAmount, 0
  );
  const activeIncomes = incomes
    .filter((income) => income.activa)
    .map((income) => ({
      ...income,
      monthlyAmount: Number(income.valor || 0) * (income.frecuencia === "quincenal" ? 2 : 1),
    }))
    .filter((income) =>
      Number.isSafeInteger(income.monthlyAmount) && income.monthlyAmount > 0
    );
  const monthlyIncome = activeIncomes.reduce((total, income) =>
    total + income.monthlyAmount, 0
  );

  return {
    items,
    incomes: activeIncomes,
    monthlyObligations,
    monthlyIncome,
    remaining: monthlyIncome - monthlyObligations,
  };
};

export const isObligationDue = (dueDate, today = getLocalDateString()) =>
  Boolean(dueDate) && String(dueDate).slice(0, 10) <= today;

export const getHomePendingObligations = (obligations, today = getLocalDateString()) => {
  const currentMonth = today.slice(0, 7);
  const activeObligations = obligations.filter((obligation) =>
    obligation.activa && !obligation.anulada && obligation.fechaProximoPago
  );
  const nextCardStatements = new Map();

  activeObligations
    .filter((obligation) =>
      obligation.tipo === "pago_tarjeta" &&
      String(obligation.fechaProximoPago).slice(0, 7) > currentMonth
    )
    .forEach((obligation) => {
      const cardId = obligation.tarjetaId || obligation.id;
      const currentNextStatement = nextCardStatements.get(cardId);
      if (!currentNextStatement ||
        String(obligation.fechaProximoPago) < String(currentNextStatement.fechaProximoPago)) {
        nextCardStatements.set(cardId, obligation);
      }
    });

  const upcomingCardStatements = new Set(nextCardStatements.values());
  return activeObligations
    .filter((obligation) => {
      if (String(obligation.fechaProximoPago).slice(0, 7) === currentMonth) return true;
      return upcomingCardStatements.has(obligation);
    })
    .sort((first, second) =>
      String(first.fechaProximoPago).localeCompare(String(second.fechaProximoPago))
    );
};

export const getDebtTotalAmount = (obligation) => {
  const debtTotal = Number(obligation?.deudaTotal || 0);
  if (debtTotal > 0) return debtTotal;

  const installmentTotal = Array.isArray(obligation?.valoresCuota)
    ? obligation.valoresCuota.reduce((total, amount) => total + (Number(amount) || 0), 0)
    : 0;
  if (installmentTotal > 0) return installmentTotal;

  const installmentAmount = Number(obligation?.valor || 0);
  const installments = Number(obligation?.cuotas || 0);
  if (installmentAmount > 0 && installments > 0) return installmentAmount * installments;

  return Number(obligation?.deudaRestante ?? obligation?.valor ?? 0);
};

export const getObligationAmount = (obligation) =>
  obligation?.tipo === "pago_tarjeta"
    ? Number(obligation.montoPendiente ?? obligation.valor ?? 0)
    : obligation?.deudaId
      ? getDebtTotalAmount(obligation)
      : Number(obligation?.valor || 0);

const isMoreRecentDebtProgress = (candidate, current) => {
  if (Boolean(candidate.deudaPagada) !== Boolean(current.deudaPagada)) {
    return Boolean(candidate.deudaPagada);
  }

  const candidateInstallment = Number(candidate.proximoPagoNumero || 1);
  const currentInstallment = Number(current.proximoPagoNumero || 1);
  if (candidateInstallment !== currentInstallment) {
    return candidateInstallment > currentInstallment;
  }

  const candidatePaidDate = String(candidate.fechaUltimoPeriodoPagado || "");
  const currentPaidDate = String(current.fechaUltimoPeriodoPagado || "");
  return candidatePaidDate > currentPaidDate ||
    (candidatePaidDate === currentPaidDate && Boolean(candidate.activa) && !current.activa);
};

export const getUniqueDebtObligations = (obligations) => {
  const debts = new Map();
  const uniqueObligations = [];

  obligations.forEach((obligation) => {
    if (!obligation.deudaId) {
      uniqueObligations.push(obligation);
      return;
    }

    const current = debts.get(obligation.deudaId);
    if (!current || isMoreRecentDebtProgress(obligation, current)) {
      debts.set(obligation.deudaId, obligation);
    }
  });

  return [...uniqueObligations, ...debts.values()];
};

export const getNextCardStatements = (obligations) => {
  const nextStatements = new Map();

  obligations
    .filter((obligation) =>
      obligation.tipo === "pago_tarjeta" &&
      obligation.activa &&
      !obligation.anulada
    )
    .forEach((obligation) => {
      const cardId = obligation.tarjetaId || obligation.id;
      const current = nextStatements.get(cardId);
      if (!current ||
        String(obligation.fechaProximoPago) < String(current.fechaProximoPago)) {
        nextStatements.set(cardId, obligation);
      }
    });

  return [...nextStatements.values()];
};

export const sortObligationsByAmount = (obligations) =>
  [...obligations].sort((first, second) =>
    getObligationAmount(second) - getObligationAmount(first)
  );

export const formatObligationDate = (value) => {
  const date = parseDateOnly(value);
  return date ? date.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" }) : "Sin fecha";
};

export const formatObligationSchedule = (obligation) => {
  const firstDay = Number(obligation?.diaVencimiento || obligation?.diaPrimerPago);
  if (obligation?.frecuencia === "quincenal" && obligation?.diaSegundoPago) {
    return `Quincenal: días ${firstDay} y ${obligation.diaSegundoPago} de cada mes`;
  }
  return obligation?.frecuencia === "quincenal"
    ? "Quincenal: cada 15 días"
    : `Mensual: día ${firstDay} de cada mes`;
};
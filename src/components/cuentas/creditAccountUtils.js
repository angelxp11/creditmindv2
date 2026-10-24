const getClampedMonthDate = (year, month, day) => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
};

export const getCreditUsageMetrics = (account) => {
  const configuredCreditLimit = Number(account?.limiteCredito);
  const available = Number(account?.saldo) || 0;
  const debt = Math.max(0, Number(account?.deudaActual) || 0);
  const creditLimit = Math.max(
    0,
    Number.isFinite(configuredCreditLimit) && configuredCreditLimit > 0
      ? configuredCreditLimit
      : available + debt
  );
  const rawUsagePercentage = account?.porcentajeUsoMaximo === null ||
    account?.porcentajeUsoMaximo === undefined ||
    account?.porcentajeUsoMaximo === ""
    ? 100
    : Number(account.porcentajeUsoMaximo);
  const usagePercentage = Number.isFinite(rawUsagePercentage)
    ? Math.min(100, Math.max(0, rawUsagePercentage))
    : 100;
  const allowedDebt = Math.floor(creditLimit * usagePercentage / 100);

  return {
    usagePercentage,
    allowedDebt,
    remainingToSpend: Math.max(0, allowedDebt - debt),
    reservedAmount: Math.max(0, creditLimit - allowedDebt),
  };
};

const getDateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const getCreditStatementDates = (account, referenceDate = new Date()) => {
  const cutoffDay = Number(account?.fechaCorte);
  const paymentDay = Number(account?.fechaLimitePago);
  if (
    !Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 31 ||
    !Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31
  ) {
    return null;
  }

  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const currentMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const cycles = [];

  for (let monthOffset = -1; monthOffset <= 2; monthOffset += 1) {
    const cutoffMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + monthOffset, 1);
    const cutoffDate = getClampedMonthDate(cutoffMonth.getFullYear(), cutoffMonth.getMonth(), cutoffDay);
    const paymentMonthOffset = paymentDay <= cutoffDay ? 1 : 0;
    const paymentMonth = new Date(cutoffMonth.getFullYear(), cutoffMonth.getMonth() + paymentMonthOffset, 1);
    const paymentDate = getClampedMonthDate(paymentMonth.getFullYear(), paymentMonth.getMonth(), paymentDay);

    if (paymentDate >= today) {
      cycles.push({ cutoffDate, paymentDate });
    }
  }

  return cycles.sort((first, second) => first.paymentDate - second.paymentDate)[0] || null;
};

export const getCreditStatementForPurchase = (account, purchaseDate = new Date()) => {
  const cutoffDay = Number(account?.fechaCorte);
  const paymentDay = Number(account?.fechaLimitePago);
  if (
    !Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 31 ||
    !Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31 ||
    !(purchaseDate instanceof Date) || Number.isNaN(purchaseDate.getTime())
  ) {
    return null;
  }

  const purchaseDay = new Date(
    purchaseDate.getFullYear(),
    purchaseDate.getMonth(),
    purchaseDate.getDate()
  );
  const cutoffDate = getClampedMonthDate(
    purchaseDay.getFullYear(),
    purchaseDay.getMonth(),
    cutoffDay
  );
  if (purchaseDay > cutoffDate) {
    const nextMonth = new Date(cutoffDate.getFullYear(), cutoffDate.getMonth() + 1, 1);
    cutoffDate.setTime(getClampedMonthDate(
      nextMonth.getFullYear(),
      nextMonth.getMonth(),
      cutoffDay
    ).getTime());
  }

  const paymentMonthOffset = paymentDay <= cutoffDay ? 1 : 0;
  const paymentMonth = new Date(
    cutoffDate.getFullYear(),
    cutoffDate.getMonth() + paymentMonthOffset,
    1
  );
  const paymentDate = getClampedMonthDate(
    paymentMonth.getFullYear(),
    paymentMonth.getMonth(),
    paymentDay
  );
  const previousCutoffMonth = new Date(cutoffDate.getFullYear(), cutoffDate.getMonth() - 1, 1);
  const previousCutoffDate = getClampedMonthDate(
    previousCutoffMonth.getFullYear(),
    previousCutoffMonth.getMonth(),
    cutoffDay
  );
  const startDate = new Date(previousCutoffDate);
  startDate.setDate(startDate.getDate() + 1);

  return { startDate, cutoffDate, paymentDate };
};

export const getCreditInstallmentAmounts = (amount, installments) => {
  if (
    !Number.isSafeInteger(amount) || amount <= 0 ||
    !Number.isSafeInteger(installments) || installments < 1 ||
    installments > amount
  ) {
    throw new Error("INVALID_CREDIT_INSTALLMENTS");
  }

  const baseAmount = Math.floor(amount / installments);
  const remainder = amount % installments;
  return Array.from({ length: installments }, (_, index) =>
    baseAmount + (index < remainder ? 1 : 0)
  );
};

export const getCreditInstallmentSchedule = (
  account,
  amount,
  installments = 1,
  purchaseDate = new Date()
) => {
  const installmentAmounts = getCreditInstallmentAmounts(amount, installments);
  const firstStatement = getCreditStatementForPurchase(account, purchaseDate);
  if (!firstStatement) return null;

  const cutoffDay = Number(account.fechaCorte);
  const paymentDay = Number(account.fechaLimitePago);
  const paymentMonthOffset = paymentDay <= cutoffDay ? 1 : 0;

  return Array.from({ length: installments }, (_, index) => {
    const cutoffMonth = new Date(
      firstStatement.cutoffDate.getFullYear(),
      firstStatement.cutoffDate.getMonth() + index,
      1
    );
    const cutoffDate = getClampedMonthDate(
      cutoffMonth.getFullYear(),
      cutoffMonth.getMonth(),
      cutoffDay
    );
    const paymentMonth = new Date(
      cutoffMonth.getFullYear(),
      cutoffMonth.getMonth() + paymentMonthOffset,
      1
    );
    const paymentDate = getClampedMonthDate(
      paymentMonth.getFullYear(),
      paymentMonth.getMonth(),
      paymentDay
    );
    const previousCutoffMonth = new Date(
      cutoffMonth.getFullYear(),
      cutoffMonth.getMonth() - 1,
      1
    );
    const previousCutoffDate = getClampedMonthDate(
      previousCutoffMonth.getFullYear(),
      previousCutoffMonth.getMonth(),
      cutoffDay
    );
    const startDate = index === 0
      ? firstStatement.startDate
      : new Date(previousCutoffDate.getFullYear(), previousCutoffDate.getMonth(), previousCutoffDate.getDate() + 1);

    return {
      installment: index + 1,
      amount: installmentAmounts[index],
      startDate,
      cutoffDate,
      paymentDate,
    };
  });
};

export const getCreditMovementStatementAmount = (
  account,
  movement,
  purchaseDate,
  statementCutoffDate
) => {
  const amount = Number(movement?.valor);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("INVALID_CARD_MOVEMENT");
  }

  if (movement.tipo === "credito_avance") {
    const recordedCutoffDate = movement.fechaCorteTarjeta
      ? String(movement.fechaCorteTarjeta).slice(0, 10)
      : null;
    if (recordedCutoffDate) return recordedCutoffDate === statementCutoffDate ? amount : 0;

    const statement = getCreditStatementForPurchase(account, purchaseDate);
    if (!statement) throw new Error("CREDIT_STATEMENT_DATES_UNAVAILABLE");
    return getDateKey(statement.cutoffDate) === statementCutoffDate ? amount : 0;
  }

  const schedule = getCreditInstallmentSchedule(
    account,
    amount,
    Number(movement.cuotas || 1),
    purchaseDate
  );
  if (!schedule) throw new Error("CREDIT_STATEMENT_DATES_UNAVAILABLE");
  return schedule.reduce((total, installment) =>
    getDateKey(installment.cutoffDate) === statementCutoffDate
      ? total + installment.amount
      : total, 0
  );
};

export const addCreditInstallmentToStatement = (statement, amount, purchaseInstallment = null) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("INVALID_CREDIT_INSTALLMENT");
  }

  const value = Number(statement?.valor || 0) + amount;
  const remaining = Number(statement?.montoPendiente ?? statement?.valor ?? 0) + amount;

  return {
    valor: value,
    montoPendiente: remaining,
    activa: remaining > 0,
    anulada: false,
    ...(purchaseInstallment ? {
      cuotasCompra: [...(statement?.cuotasCompra || []), purchaseInstallment],
    } : {}),
  };
};

export const applyCreditPurchase = (account, amount) => {
  if (account?.tipoCuenta !== "credito") {
    throw new Error("NOT_A_CREDIT_ACCOUNT");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("INVALID_CREDIT_AMOUNT");
  }

  const available = Number(account.saldo || 0);
  const debt = Number(account.deudaActual || 0);
  const limit = Number(account.limiteCredito || available + debt);
  if (amount > available || debt + amount > limit) {
    throw new Error("CREDIT_LIMIT_EXCEEDED");
  }
  const { allowedDebt } = getCreditUsageMetrics(account);
  if (debt + amount > allowedDebt) {
    throw new Error("CREDIT_USAGE_LIMIT_EXCEEDED");
  }

  return {
    saldo: available - amount,
    deudaActual: debt + amount,
  };
};

export const applyCreditAdvance = (account, amount) => {
  const charge = Number(account?.cargoAvance);
  if (!Number.isSafeInteger(charge) || charge < 0) {
    throw new Error("INVALID_CREDIT_ADVANCE_CHARGE");
  }

  const totalAmount = amount + charge;
  if (!Number.isSafeInteger(totalAmount)) {
    throw new Error("INVALID_CREDIT_AMOUNT");
  }

  return applyCreditPurchase(account, totalAmount);
};

export const applyCreditPayment = (account, amount) => {
  if (account?.tipoCuenta !== "credito") {
    throw new Error("NOT_A_CREDIT_ACCOUNT");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("INVALID_CREDIT_AMOUNT");
  }

  const available = Number(account.saldo || 0);
  const debt = Number(account.deudaActual || 0);
  const limit = Number(account.limiteCredito || available + debt);
  if (amount > debt) {
    throw new Error("PAYMENT_EXCEEDS_CREDIT_DEBT");
  }

  return {
    saldo: Math.min(limit, available + amount),
    deudaActual: debt - amount,
  };
};

const getClampedMonthDate = (year, month, day) => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
};

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

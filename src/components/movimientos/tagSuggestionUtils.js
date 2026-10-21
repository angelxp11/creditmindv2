const parseAmount = (value) => {
  const amount = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/\./g, ""));
  return Number.isFinite(amount) ? Math.abs(amount) : Number.NaN;
};

export const getSimilarMovements = (history, establishment, value) => {
  const searchName = String(establishment || "").trim().toUpperCase();
  const searchAmount = parseAmount(value);
  if (!searchName || !Number.isFinite(searchAmount) || searchAmount === 0) {
    return [];
  }

  return history.filter((movement) => {
    const savedName = String(movement.establecimiento || "").toUpperCase();
    const savedAmount = parseAmount(movement.valor);
    const relativeDifference =
      Math.abs(savedAmount - searchAmount) / Math.max(savedAmount, searchAmount);
    return (
      savedName.includes(searchName) &&
      Number.isFinite(savedAmount) &&
      savedAmount > 0 &&
      relativeDifference <= 0.2
    );
  });
};

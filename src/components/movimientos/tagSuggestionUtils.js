const parseAmount = (value) => {
  const amount = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/\./g, ""));
  return Number.isFinite(amount) ? Math.abs(amount) : Number.NaN;
};

export const getSimilarMovements = (history, establishment, value) => {
  const searchNames = (Array.isArray(establishment) ? establishment : [establishment])
    .map((name) => String(name || "").trim().toUpperCase())
    .filter(Boolean);
  const searchAmount = parseAmount(value);
  if (!searchNames.length || !Number.isFinite(searchAmount) || searchAmount === 0) {
    return [];
  }

  return history.filter((movement) => {
    const savedNames = [
      movement.establecimiento,
      movement.nombreLegal,
      movement.nombreEstablecimiento,
    ]
      .map((name) => String(name || "").trim().toUpperCase())
      .filter(Boolean);
    const savedAmount = parseAmount(movement.valor);
    const relativeDifference =
      Math.abs(savedAmount - searchAmount) / Math.max(savedAmount, searchAmount);
    return (
      savedNames.some((savedName) =>
        searchNames.some((searchName) =>
          savedName.includes(searchName) || searchName.includes(savedName)
        )
      ) &&
      Number.isFinite(savedAmount) &&
      savedAmount > 0 &&
      relativeDifference <= 0.2
    );
  });
};

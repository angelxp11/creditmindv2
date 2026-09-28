import savingsCard from "./ahorros.png";
import debitCard from "./debito.png";
import creditCard from "./credito.png";

const cardImages = {
  ahorros: savingsCard,
  debito: debitCard,
  credito: creditCard,
};

export const ACCOUNT_CARD_OPTIONS = [
  { key: "debito", label: "Débito", image: debitCard },
  { key: "credito", label: "Crédito", image: creditCard },
  { key: "ahorros", label: "Ahorros", image: savingsCard },
];

export const getAccountCardKey = (accountType) =>
  accountType === "ahorros" ? "ahorros" : accountType === "credito" ? "credito" : "debito";

export const getAccountCardImage = (account) =>
  cardImages[account?.imagenTarjeta] || cardImages[getAccountCardKey(account?.tipoCuenta)];
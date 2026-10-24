import savingsCard from "./ahorros.png";
import debitCard from "./debito.png";
import creditCard from "./credito.png";
import daviplataCard from "./daviplata.png";

const cardImages = {
  ahorros: savingsCard,
  debito: debitCard,
  credito: creditCard,
  daviplata: daviplataCard,
};

export const ACCOUNT_CARD_OPTIONS = [
  { key: "debito", label: "Débito", image: debitCard },
  { key: "credito", label: "Crédito", image: creditCard },
  { key: "daviplata", label: "Daviplata", image: daviplataCard },
  { key: "ahorros", label: "Ahorros", image: savingsCard },
];

export const getAccountCardKey = (accountType) =>
  accountType === "ahorros" ? "ahorros" : accountType === "credito" ? "credito" : "debito";

export const getAccountCardImage = (account) =>
  cardImages[account?.imagenTarjeta] || cardImages[getAccountCardKey(account?.tipoCuenta)];
import { getSimilarMovements } from "./tagSuggestionUtils";

const history = [
  { establecimiento: "CINE", valor: 7000, tags: ["ENTRADACINE"] },
  {
    establecimiento: "CINE",
    valor: 60000,
    tags: ["ENTRADACINE", "COMIDA", "TRANSPORTE"],
  },
];

test("suggestions only include tags from transactions with a similar amount", () => {
  const similar = getSimilarMovements(history, "cine", "7.000");

  expect(similar).toEqual([history[0]]);
});

test("amount matching allows modest variation", () => {
  const similar = getSimilarMovements(
    [{ establecimiento: "CINE", valor: 8000 }],
    "CINE",
    "7.000"
  );

  expect(similar).toHaveLength(1);
});

test("does not suggest movements with a substantially different amount", () => {
  const similar = getSimilarMovements(
    [{ establecimiento: "CINE", valor: 60000 }],
    "CINE",
    "7.000"
  );

  expect(similar).toHaveLength(0);
});

test("matches a previously recognized merchant name as well as the legal name", () => {
  const previousMovement = {
    establecimiento: "COMERCIO S.A.S.",
    nombreLegal: "COMERCIO S.A.S.",
    nombreEstablecimiento: "CAFÉ LUNA",
    valor: 12000,
    tags: ["CAFÉ"],
  };

  expect(getSimilarMovements(
    [previousMovement],
    ["COMERCIO S.A.S.", "CAFÉ LUNA"],
    12000
  )).toEqual([previousMovement]);
});

test("matches a shorter saved merchant name against the Wallet legal name", () => {
  const previousMovement = {
    establecimiento: "KFC",
    valor: 3200,
    tags: ["COMIDA"],
  };

  expect(getSimilarMovements(
    [previousMovement],
    "KFC COLOMBIA S.A.S.",
    3200
  )).toEqual([previousMovement]);
});

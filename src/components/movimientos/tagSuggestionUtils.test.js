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

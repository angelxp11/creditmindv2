import {
  extractPlacesFromMovements,
  getPlaceDistanceMeters,
  parsePlaceCoordinates,
  resolvePlaceName,
} from "./lugarUtils";

describe("parsePlaceCoordinates", () => {
  it("parses valid latitude and longitude in the requested format", () => {
    expect(parsePlaceCoordinates("7.100471656254416, -73.10723809468608")).toEqual({
      latitud: 7.100471656254416,
      longitud: -73.10723809468608,
    });
  });

  it("rejects invalid coordinate values", () => {
    expect(parsePlaceCoordinates("91, -73")).toBeNull();
    expect(parsePlaceCoordinates("7, -181")).toBeNull();
    expect(parsePlaceCoordinates("7.1")).toBeNull();
  });
});

describe("getPlaceDistanceMeters", () => {
  it("measures the distance between two GPS coordinates", () => {
    expect(getPlaceDistanceMeters(
      { latitud: 7.1, longitud: -73.1 },
      { latitud: 7.1001, longitud: -73.1 }
    )).toBeGreaterThan(10);
    expect(getPlaceDistanceMeters(
      { latitud: 7.1, longitud: -73.1 },
      { latitud: 7.1001, longitud: -73.1 }
    )).toBeLessThan(50);
  });

  it("keeps coordinate variations within 50 meters in the same place", () => {
    const savedLocation = { latitud: 7.1, longitud: -73.1 };
    const nearbyLocation = { latitud: 7.1004, longitud: -73.1 };
    const distantLocation = { latitud: 7.1006, longitud: -73.1 };

    expect(getPlaceDistanceMeters(savedLocation, nearbyLocation)).toBeLessThan(50);
    expect(getPlaceDistanceMeters(savedLocation, distantLocation)).toBeGreaterThan(50);
  });
});

describe("extractPlacesFromMovements", () => {
  it("groups merchant movements and applies a saved legal-name mapping", () => {
    const places = extractPlacesFromMovements([
      {
        establecimiento: "COMIDAS RAPIDAS S.A.S.",
        nombreEstablecimiento: "KFC",
        fechaHora: "2026-10-23T17:39:00",
        ubicacion: { latitud: 7.1, longitud: -73.1 },
      },
      {
        establecimiento: "COMIDAS RAPIDAS S.A.S.",
        nombreEstablecimiento: "KFC EXPRESS",
        fechaHora: "2026-10-24T17:39:00",
        ubicacion: { latitud: 7.10005, longitud: -73.10005 },
      },
    ], [{
      nombreLegal: "comidas rapidas s.a.s.",
      nombreLugar: "KFC Cabecera",
    }]);

    expect(places).toEqual([{
      id: "COMIDAS RAPIDAS S.A.S.::7.10000,-73.10000",
      nombreLegal: "COMIDAS RAPIDAS S.A.S.",
      nombreLugar: "KFC Cabecera",
      sourceName: "COMIDAS RAPIDAS S.A.S.",
      sourceNames: ["COMIDAS RAPIDAS S.A.S."],
      sourceIds: ["COMIDAS RAPIDAS S.A.S.::7.10000,-73.10000"],
      tieneRelacion: true,
      sinTarjeta: false,
      movimientos: 2,
      ubicacion: { latitud: 7.10005, longitud: -73.10005 },
    }]);
  });

  it("merges places that share the identified name even when legal names and coordinates differ", () => {
    const places = extractPlacesFromMovements([
      {
        establecimiento: "KFC",
        nombreEstablecimiento: "KFC CACIQUE",
        valor: 3200,
        ubicacion: { latitud: 7.10047, longitud: -73.10723 },
      },
      {
        establecimiento: "COMIDAS RAPIDAS S.A.S.",
        nombreEstablecimiento: "KFC CACIQUE",
        valor: 5600,
        ubicacion: { latitud: 7.11, longitud: -73.11 },
      },
    ]);

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      nombreLugar: "KFC CACIQUE",
      movimientos: 2,
    });
    expect(places[0].sourceNames).toEqual(
      expect.arrayContaining(["COMIDAS RAPIDAS S.A.S.", "KFC"])
    );
    expect(places[0].sourceIds).toHaveLength(2);
  });

  it("merges different identified names when their legal name is shared", () => {
    const places = extractPlacesFromMovements([
      {
        establecimiento: "KFC",
        nombreEstablecimiento: "KFC CACIQUE",
        valor: 3200,
        ubicacion: { latitud: 7.1, longitud: -73.1 },
      },
      {
        establecimiento: "KFC",
        nombreEstablecimiento: "KFC CABECERA",
        valor: 5600,
        ubicacion: { latitud: 7.11, longitud: -73.11 },
      },
    ]);

    expect(places).toHaveLength(1);
    expect(places[0].movimientos).toBe(2);
  });

  it("merges different names when their locations are within 50 meters", () => {
    const places = extractPlacesFromMovements([
      {
        establecimiento: "KFC",
        nombreEstablecimiento: "KFC CACIQUE",
        ubicacion: { latitud: 7.1, longitud: -73.1 },
      },
      {
        establecimiento: "CAFETERIA",
        nombreEstablecimiento: "CAFE DEL PARQUE",
        ubicacion: { latitud: 7.1001, longitud: -73.1 },
      },
    ]);

    expect(places).toHaveLength(1);
    expect(places[0].movimientos).toBe(2);
  });

  it("shows the saved Wallet legal name after reloading the place list", () => {
    const [place] = extractPlacesFromMovements([{
      establecimiento: "COMERCIO ORIGINAL",
      nombreEstablecimiento: "Mi cafetería",
      ubicacion: { latitud: 7.1, longitud: -73.1 },
    }], [{
      id: "COMERCIO ORIGINAL::7.10000,-73.10000",
      establecimientoNormalizado: "COMERCIO ORIGINAL",
      nombreLegal: "NUEVO NOMBRE WALLET",
      nombreLugar: "Mi cafetería",
      ubicacion: { latitud: 7.1, longitud: -73.1 },
      sinTarjeta: false,
    }]);

    expect(place.nombreLegal).toBe("NUEVO NOMBRE WALLET");
    expect(place.tieneRelacion).toBe(true);
  });

  it("keeps a location-only place saved without marking a legal-name relation", () => {
    const [place] = extractPlacesFromMovements([{
      establecimiento: "COMERCIO",
      nombreEstablecimiento: "Mi tienda",
      ubicacion: { latitud: 7.1, longitud: -73.1 },
    }], [{
      id: "COMERCIO::7.10000,-73.10000",
      establecimientoNormalizado: "COMERCIO",
      nombreLugar: "Mi tienda",
      nombreLegal: "",
      ubicacion: { latitud: 7.1001, longitud: -73.1 },
      sinTarjeta: false,
    }]);

    expect(place).toMatchObject({
      nombreLugar: "Mi tienda",
      nombreLegal: "COMERCIO",
      tieneRelacion: false,
      ubicacion: { latitud: 7.1001, longitud: -73.1 },
    });
  });

  it("restores a saved place with coordinates when later movements have no location", () => {
    const [place] = extractPlacesFromMovements([{
      establecimiento: "KFC",
      nombreEstablecimiento: "KFC",
      valor: 3200,
    }], [{
      id: "KFC::7.10000,-73.10000",
      establecimientoNormalizado: "KFC",
      nombreLegal: "KFC CACIQUE",
      nombreLugar: "KFC Cacique",
      ubicacion: { latitud: 7.1, longitud: -73.1 },
      sinTarjeta: false,
    }]);

    expect(place).toMatchObject({
      nombreLegal: "KFC CACIQUE",
      nombreLugar: "KFC Cacique",
      tieneRelacion: true,
      ubicacion: { latitud: 7.1, longitud: -73.1 },
    });
  });

  it("merges distant franchises when their legal names are identical", () => {
    const places = extractPlacesFromMovements([
      {
        establecimiento: "FRANQUICIA S.A.S.",
        nombreEstablecimiento: "Café Norte",
        ubicacion: { latitud: 7.1, longitud: -73.1 },
      },
      {
        establecimiento: "FRANQUICIA S.A.S.",
        nombreEstablecimiento: "Café Sur",
        ubicacion: { latitud: 7.11, longitud: -73.11 },
      },
    ], [{
      establecimientoNormalizado: "FRANQUICIA S.A.S.",
      nombreLegal: "FRANQUICIA S.A.S.",
      nombreLugar: "Café Norte",
      ubicacion: { latitud: 7.1, longitud: -73.1 },
    }]);

    expect(places).toHaveLength(1);
    expect(places[0].movimientos).toBe(2);
    expect(places[0].tieneRelacion).toBe(true);
  });

  it("does not treat empty coordinates as a location", () => {
    expect(extractPlacesFromMovements([{
      establecimiento: "TIENDA",
      ubicacion: { latitud: null, longitud: "" },
    }])[0].ubicacion).toBeNull();
  });

  it("marks merchants without a saved legal-name mapping as unassigned", () => {
    const [place] = extractPlacesFromMovements([{
      establecimiento: "TIENDA",
      nombreEstablecimiento: "Tienda del barrio",
    }]);

    expect(place.tieneRelacion).toBe(false);
  });

  it("ignores income and transfer movements when extracting places", () => {
    const places = extractPlacesFromMovements([
      { descripcion: "Salario", valor: 1000000 },
      { tipo: "transferencia", establecimiento: "PAGO ENTRE CUENTAS", valor: 50000 },
      { tipo: "pago_deuda", establecimiento: "Pago deuda: préstamo", valor: 25000 },
      { establecimiento: "KFC", valor: 3200 },
    ]);

    expect(places).toHaveLength(1);
    expect(places[0].nombreLegal).toBe("KFC");
  });

  it("recognizes a saved no-card place without assigning a legal name", () => {
    const [place] = extractPlacesFromMovements([{
      establecimiento: "CAFETERIA CENTRAL",
      nombreEstablecimiento: "Cafetería Central",
    }], [{
      id: "CAFETERIA CENTRAL",
      establecimientoNormalizado: "CAFETERIA CENTRAL",
      nombreLugar: "Cafetería Central",
      nombreLegal: "",
      sinTarjeta: true,
    }]);

    expect(place).toMatchObject({
      nombreLugar: "Cafetería Central",
      nombreLegal: "",
      tieneRelacion: true,
      sinTarjeta: true,
    });
  });
});

describe("resolvePlaceName", () => {
  it("resolves a legal wallet merchant name to its saved place", () => {
    expect(resolvePlaceName("COMIDAS RAPIDAS S.A.S.", [{
      nombreLegal: "Comidas Rapidas S.A.S.",
      nombreLugar: "KFC Cabecera",
    }])).toBe("KFC Cabecera");
  });

  it("does not treat no-card places as wallet legal-name mappings", () => {
    expect(resolvePlaceName("CAFETERIA CENTRAL", [{
      nombreLegal: "",
      establecimientoNormalizado: "CAFETERIA CENTRAL",
      nombreLugar: "Cafetería Central",
      sinTarjeta: true,
    }])).toBe("");
  });
});

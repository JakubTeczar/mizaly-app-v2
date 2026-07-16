// true = funkcja zablokowana ("Wkrótce"), false = odblokowana. Przełącz tutaj, gdy funkcja wystartuje.
export const FEATURE_FLAGS = {
  tworzenieStrona: true,
  tworzenieReels: true,
  wiadomosci: true,
  analitykaOstatniePosty: true,
  postAiDokladne: true,
  postPierwszyKomentarz: true,
} as const;

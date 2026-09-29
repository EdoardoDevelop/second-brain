// Caricato prima di ogni test: i moduli che aprono il database non devono toccare quello vero.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || ":memory:";
process.env.TZ = process.env.TZ || "Europe/Rome";

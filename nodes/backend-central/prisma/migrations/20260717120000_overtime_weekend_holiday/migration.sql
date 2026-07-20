-- HE fin de semana/feriado: cuando es true, no se descuenta el turno y todo el
-- periodo entra como hora extra. Additive, default seguro para las filas existentes.
ALTER TABLE "overtime_requests" ADD COLUMN "weekendOrHoliday" BOOLEAN NOT NULL DEFAULT false;

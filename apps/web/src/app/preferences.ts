const rollForwardDateKey = "lifeos.rollForwardTargetDate";

export function validRollForwardDate(value: string | null, today: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today ? value : today;
}

export function loadRollForwardDate(
  today: string,
  storage?: Pick<Storage, "getItem">,
): string {
  return validRollForwardDate(storage?.getItem(rollForwardDateKey) ?? null, today);
}

export function saveRollForwardDate(value: string, storage: Pick<Storage, "setItem">): void {
  storage.setItem(rollForwardDateKey, value);
}

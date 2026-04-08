export const cookieExtractor = (cookieName: string) => {
  return (req: Record<string, Record<string, string>>): string | null =>
    req?.cookies?.[cookieName] ?? null;
};

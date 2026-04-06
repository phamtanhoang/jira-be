export const cookieExtractor = (cookieName: string) => {
  return (req: any) => req?.cookies?.[cookieName] ?? null;
};

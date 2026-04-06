export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret',
    accessTokenExpiration: parseInt(process.env.JWT_ACCESS_TOKEN_EXPIRATION || '900', 10),
    refreshTokenExpiration: parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRATION || '604800', 10),
    tokenVerifyExpiry: parseInt(process.env.TOKEN_VERIFY_EXPIRY || '60', 10),
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
  },
});

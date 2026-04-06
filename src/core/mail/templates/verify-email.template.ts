interface VerifyEmailParams {
  appName: string;
  logoUrl: string;
  otp: string;
  expirySeconds: number;
}

export const verifyEmailTemplate = ({
  appName,
  logoUrl,
  otp,
  expirySeconds,
}: VerifyEmailParams): string => {
  const expiryMinutes = Math.floor(expirySeconds / 60);
  const expiryLabel =
    expiryMinutes >= 1 ? `${expiryMinutes} minute(s)` : `${expirySeconds} second(s)`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f9fc; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="420" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0052cc 0%, #2684ff 100%); padding: 32px 40px; text-align: center;">
              <img src="${logoUrl}" alt="${appName}" width="40" height="40" style="display: inline-block; vertical-align: middle; margin-right: 12px;" />
              <span style="color: #ffffff; font-size: 24px; font-weight: 700; vertical-align: middle;">${appName}</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 600; color: #172b4d;">Verify your email</h2>
              <p style="margin: 0 0 24px; font-size: 14px; color: #6b778c; line-height: 1.5;">
                Enter the code below to verify your email address.
              </p>
              <!-- OTP Code -->
              <div style="background-color: #f4f5f7; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 10px; color: #0052cc; font-family: 'Courier New', monospace;">${otp}</span>
              </div>
              <p style="margin: 0; font-size: 13px; color: #97a0af; text-align: center;">
                This code expires in <strong>${expiryLabel}</strong>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #fafbfc; border-top: 1px solid #ebecf0; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #97a0af;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

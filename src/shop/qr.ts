import QRCode from 'qrcode';

/**
 * Генерация QR-кода оплаты.
 *
 * ВАЖНО для зрителя: этот QR — демонстрационный. Внутри лежит строка
 * вида shop://order/12?amount=8480&cur=RUB — банк её не поймёт.
 *
 * Чтобы QR стал настоящим, надо заменить payload на ссылку, которую
 * выдаёт платёжный шлюз: СБП, ЮKassa, Telegram Payments. Код генерации
 * при этом не меняется вообще — меняется только строка внутри.
 */
export async function makePaymentQr(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#101014',
      light: '#ffffff',
    },
  });
}

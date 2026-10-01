import QRCode from "qrcode";
import Image from "next/image";

export default async function QrCode({ value }: { value: string }) {
  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });

  return <Image src={dataUrl} alt="Scannable election verification QR code" width={220} height={220} unoptimized />;
}
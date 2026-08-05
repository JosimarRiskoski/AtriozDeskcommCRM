import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

/** Favicon oficial do Atrios CRM Inteligente, gerado a partir do logo fornecido. */
export default async function Icon() {
  const logo = await readFile(new URL("../logo/favicon-64.png", import.meta.url));
  const encodedLogo = Buffer.from(logo).toString("base64");

  return new ImageResponse(
    <img
      alt="Atrios CRM Inteligente"
      height={64}
      src={`data:image/png;base64,${encodedLogo}`}
      style={{ height: "64px", width: "64px" }}
      width={64}
    />,
    { ...size },
  );
}

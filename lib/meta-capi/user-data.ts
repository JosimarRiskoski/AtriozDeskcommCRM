import { createHash } from "node:crypto";
const sha256=(value:string)=>createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
export function normalizedMetaUserData(phone?:string|null,email?:string|null){return{...(phone?{ph:[sha256(phone.replace(/\D/g,""))]}:{}),...(email?{em:[sha256(email)]}:{})}}

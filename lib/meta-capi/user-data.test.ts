import { describe,expect,it } from "vitest";
import { normalizedMetaUserData } from "./user-data";
describe("Meta CAPI user data",()=>{it("normaliza e aplica SHA-256 sem devolver PII",()=>{const data=normalizedMetaUserData("+55 (47) 99999-9999"," TESTE@EXAMPLE.COM ");expect(data.ph?.[0]).toMatch(/^[a-f0-9]{64}$/);expect(data.em?.[0]).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(data)).not.toContain("5547");expect(JSON.stringify(data)).not.toContain("example.com")})});

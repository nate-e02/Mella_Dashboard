import "server-only";
import { cache } from "react";
import { getPublicCertificate } from "@/lib/services/certificates";

/** One lookup per request, shared by generateMetadata, the page and the OG image. */
export const loadCertificate = cache(getPublicCertificate);

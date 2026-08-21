import Link from "next/link";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";
import PrivacyAcceptButton from "./PrivacyAcceptButton";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-gray-900">
        Agent Network Studio: Privacy Policy & Terms of Use
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        Effective Date: August 13, 2026
        <br />
        Status: Personal Project (Unofficial)
      </p>

      <PrivacyPolicyContent />

      <div className="mt-10 flex flex-col gap-4 border-t border-gray-200 pt-8">
        <PrivacyAcceptButton />
        <p className="text-sm text-gray-500">
          <Link href="/" className="text-primary hover:underline">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

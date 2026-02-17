"use client";

import { useRouter } from "next/navigation";

export default function SignInButton() {
  const router = useRouter();

  const handleSignIn = () => {
    router.push("/auth/sign-in");
  };

  return (
    <button
      type="button"
      onClick={handleSignIn}
      className="rounded-anypoint-button bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
    >
      Sign In
    </button>
  );
}

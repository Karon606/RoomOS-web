'use client';

export default function Loading() {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-[#f5efe6]/70 p-4 backdrop-blur-sm">
      <div className="rounded-3xl bg-[#0d0f14]/5 p-12">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#7a6a5a]/20 border-t-[#f4623a]">
        </div>
      </div>
    </div>
  );
}
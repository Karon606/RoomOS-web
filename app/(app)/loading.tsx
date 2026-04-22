// app/(app)/loading.tsx
'use client'; // 배경 블러 효과를 위해 클라이언트 컴포넌트 선언

export default function Loading() {
  return (
    // 전체 내용 영역을 덮는 컨테이너
    // bg-[#f5efe6]/70: RoomOS Canvas 컬러에 70% 투명도 적용 (기존 화면 노출)
    // backdrop-blur-sm: 뒷배경을 은은하게 흐릿하게 처리
    <div className="relative flex h-full w-full items-center justify-center bg-[#f5efe6]/70 p-4 backdrop-blur-sm">
      
      {/* 중앙의 세련된 스피너 박스 (선택 사항 - 기획에 따라 제거 가능) */}
      <div className="rounded-3xl bg-[#0d0f14]/5 p-12 shadow-inner">
        {/* RoomOS 브랜드 스피너
          - border-[#7a6a5a]/20: Warm Mid 컬러에 투명도를 주어 은은한 테두리
          - border-t-[#f4623a]: 브랜드 메인 Coral 컬러 포인트
        */}
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#7a6a5a]/20 border-t-[#f4623a]">
        </div>
      </div>
      
    </div>
  );
}
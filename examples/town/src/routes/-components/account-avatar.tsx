import { useState } from "react";

export const AccountAvatar = ({
  name,
  src,
}: {
  name: string;
  src: string | undefined;
}) => {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-950"
      aria-hidden="true"
    >
      {src && !failed ? (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          src={src}
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
};

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const Icon = ({ children, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="1.8"
    {...props}
  >
    {children}
  </svg>
);

export const AccountsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16 18.5a4 4 0 0 0-8 0" />
    <circle cx="12" cy="9" r="3" />
    <path d="M18.5 7.5a2.2 2.2 0 0 1 0 4.2M5.5 7.5a2.2 2.2 0 0 0 0 4.2M19.5 17a3 3 0 0 0-2.5-2.95M4.5 17A3 3 0 0 1 7 14.05" />
  </Icon>
);

export const ArrowIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 12 4 4L19 6" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ShieldIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 5.5 5.8v5.4c0 4.2 2.6 7.6 6.5 9.8 3.9-2.2 6.5-5.6 6.5-9.8V5.8L12 3Z" />
    <path d="m9.2 12 1.8 1.8 3.8-4" />
  </Icon>
);

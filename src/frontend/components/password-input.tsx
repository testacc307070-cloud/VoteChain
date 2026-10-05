"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
}

export function PasswordInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  required,
  minLength,
  maxLength,
  autoComplete,
  disabled,
  style,
  className,
  inputClassName,
  inputStyle,
  ...rest
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: "100%",
        ...style,
      }}
      className={className}
    >
      <input
        {...rest}
        id={id}
        name={name}
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={autoComplete}
        disabled={disabled}
        className={inputClassName}
        style={{
          width: "100%",
          boxSizing: "border-box",
          ...inputStyle,
          paddingRight: "2.75rem",
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShowPassword((prev) => !prev)}
        aria-label={showPassword ? "Hide password" : "Show password"}
        title={showPassword ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: "0.5rem",
          top: "50%",
          transform: "translateY(-50%)",
          background: "transparent",
          border: "none",
          padding: "0.25rem",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          color: "#849389",
          borderRadius: "4px",
          transition: "color 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#355e4b")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#849389")}
      >
        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

export default PasswordInput;

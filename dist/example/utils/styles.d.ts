import { CSSProperties } from 'react';
export declare const styleReset = "\n    * {\n        margin: 0;\n        padding: 0;\n        box-sizing: border-box;\n        font-weight: inherit;\n    }\n";
export declare const bodyDefault: CSSProperties;
export declare const mainDefault: CSSProperties;
export declare const htmlDefault: CSSProperties;
type ButtonStyleProps = {
    backgroundColor?: string;
    color?: string;
    width?: string;
};
export declare const buttonStyle: ({ backgroundColor, color, width }: ButtonStyleProps) => CSSProperties;
export declare const authContainerStyle: CSSProperties;
export declare const textButtonStyle: CSSProperties;
export declare const contentStyle: CSSProperties;
export {};

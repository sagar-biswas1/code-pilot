import { useTheme } from "../providers/theme";


type Props = {
  children: React.ReactNode;
}

export const ThemedRoot = ({ children }: Props) => {
    const { colors } = useTheme();
    return (
        <box alignItems="center" justifyContent="center" flexGrow={1} backgroundColor={colors.background}
        
        width="100%"
        height="100%"
        >
            {children}
        </box>
    )
}
import Foundation

/// 本批工具：base64、url-codec、html-entities、unicode-escape、jwt-decoder、hash、hmac、aes-des、rsa
public enum EncodeCryptoTools {
    public static let all: [ToolSpec] = [
        Base64Tool.spec,
        URLCodecTool.spec,
        HTMLEntitiesTool.spec,
        UnicodeEscapeTool.spec,
        JWTTool.spec,
        HashTool.spec,
        HMACTool.spec,
        AESDESTool.spec,
        RSATool.spec,
    ]
}

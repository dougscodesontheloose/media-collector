import AppKit
import Foundation
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let lock = NSLock()
    private static var tasks: [String: URLSessionDownloadTask] = [:]
    private static let categories = Set(["Instagram", "X.com", "Reddit", "Web geral"])

    func beginRequest(with context: NSExtensionContext) {
        guard
            let item = context.inputItems.first as? NSExtensionItem,
            let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any],
            let action = message["action"] as? String
        else {
            complete(context, ["event": "error", "error": "Mensagem nativa inválida."])
            return
        }

        switch action {
        case "safari-download":
            download(message, context: context)
        case "safari-cancel":
            let identifier = message["id"] as? String ?? ""
            Self.lock.lock()
            let task = Self.tasks.removeValue(forKey: identifier)
            Self.lock.unlock()
            task?.cancel()
            complete(context, ["id": identifier, "event": "done"])
        case "safari-reveal", "safari-open":
            reveal(message, open: action == "safari-open", context: context)
        default:
            complete(context, [
                "id": message["id"] as? String ?? "",
                "event": "error",
                "retryable": false,
                "error": "Este recurso ainda não foi migrado para o Safari."
            ])
        }
    }

    private func download(_ message: [String: Any], context: NSExtensionContext) {
        let identifier = message["id"] as? String ?? UUID().uuidString
        guard
            let rawURL = message["url"] as? String,
            let source = URL(string: rawURL),
            ["http", "https"].contains(source.scheme?.lowercased() ?? ""),
            source.host != nil,
            source.user == nil,
            source.password == nil,
            let requested = message["filename"] as? String,
            let destination = safeDestination(for: requested)
        else {
            complete(context, ["id": identifier, "event": "error", "retryable": false, "error": "Destino ou fonte inválida."])
            return
        }

        var request = URLRequest(url: source)
        request.timeoutInterval = 60
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let task = URLSession.shared.downloadTask(with: request) { temporary, response, error in
            Self.lock.lock()
            Self.tasks.removeValue(forKey: identifier)
            Self.lock.unlock()

            if let error = error as NSError? {
                let cancelled = error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled
                self.complete(context, [
                    "id": identifier,
                    "event": "error",
                    "retryable": !cancelled,
                    "error": cancelled ? "Download cancelado." : "A transferência não foi concluída."
                ])
                return
            }
            guard let temporary else {
                self.complete(context, ["id": identifier, "event": "error", "error": "O servidor não entregou um arquivo."])
                return
            }

            do {
                let finalURL = try self.publish(temporary, at: destination)
                let values = try finalURL.resourceValues(forKeys: [.fileSizeKey])
                self.complete(context, [
                    "id": identifier,
                    "event": "done",
                    "filename": finalURL.path,
                    "size": values.fileSize ?? 0,
                    "mime": response?.mimeType ?? "application/octet-stream"
                ])
            } catch {
                self.complete(context, ["id": identifier, "event": "error", "error": "Não foi possível publicar o arquivo em Downloads."])
            }
        }
        Self.lock.lock()
        Self.tasks[identifier] = task
        Self.lock.unlock()
        task.resume()
    }

    private func safeDestination(for requested: String) -> URL? {
        let parts = requested.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count == 3, parts[0] == "Media Collector", Self.categories.contains(parts[1]) else { return nil }
        let filename = parts[2]
        guard filename != ".", filename != "..", !filename.contains(":"), filename.utf8.count <= 240 else { return nil }
        guard let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else { return nil }
        return downloads.appendingPathComponent("Media Collector", isDirectory: true)
            .appendingPathComponent(parts[1], isDirectory: true)
            .appendingPathComponent(filename, isDirectory: false)
    }

    private func publish(_ temporary: URL, at requested: URL) throws -> URL {
        let manager = FileManager.default
        try manager.createDirectory(at: requested.deletingLastPathComponent(), withIntermediateDirectories: true)
        let stem = requested.deletingPathExtension().lastPathComponent
        let ext = requested.pathExtension
        var candidate = requested
        var suffix = 2
        while manager.fileExists(atPath: candidate.path) {
            let name = ext.isEmpty ? "\(stem)-\(suffix)" : "\(stem)-\(suffix).\(ext)"
            candidate = requested.deletingLastPathComponent().appendingPathComponent(name)
            suffix += 1
        }
        try manager.moveItem(at: temporary, to: candidate)
        return candidate
    }

    private func reveal(_ message: [String: Any], open: Bool, context: NSExtensionContext) {
        guard
            let filename = message["filename"] as? String,
            let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first,
            URL(fileURLWithPath: filename).standardizedFileURL.path.hasPrefix(
                downloads.appendingPathComponent("Media Collector", isDirectory: true).standardizedFileURL.path + "/"
            ),
            FileManager.default.fileExists(atPath: filename)
        else {
            complete(context, ["event": "error", "retryable": false, "error": "Arquivo salvo inválido."])
            return
        }
        let url = URL(fileURLWithPath: filename)
        if open { NSWorkspace.shared.open(url) }
        else { NSWorkspace.shared.activateFileViewerSelecting([url]) }
        complete(context, ["event": "done"])
    }

    private func complete(_ context: NSExtensionContext, _ message: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: message]
        context.completeRequest(returningItems: [response])
    }
}

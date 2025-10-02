import { PaperbackInterceptor, Request, Response } from "@paperback/types";

export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // You could block specific URLs here if needed (ads, trackers, etc.)
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> {
    try {
      // Decode the response into a string
      const html = Application.arrayBufferToUTF8String(data);

      // Remove all HTML comments (<!-- ... -->)
      const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");

      // Convert back into ArrayBuffer
      return Application.stringToUTF8Array(cleaned);
    } catch (err) {
      console.log(`[INTERCEPT ERROR] Failed to clean response for ${request.url}: ${String(err)}`);
      return data; // fallback to original if something breaks
    }
  }
}

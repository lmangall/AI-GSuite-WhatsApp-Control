import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ResultFormatterService {
  private readonly logger = new Logger(ResultFormatterService.name);

  /**
   * Format tool results for human-friendly display
   */
  formatToolResult(toolName: string, result: any): string {
    try {
      let formatted: string;

      // Handle email-related tools
      if (this.isEmailTool(toolName)) {
        formatted = this.formatEmailResult(result);
      }
      // Handle calendar tools
      else if (this.isCalendarTool(toolName)) {
        formatted = this.formatCalendarResult(result);
      }
      // Handle other Google Workspace tools
      else if (this.isGoogleWorkspaceTool(toolName)) {
        formatted = this.formatGoogleWorkspaceResult(toolName, result);
      }
      // Default formatting for other tools
      else {
        formatted = this.formatGenericResult(result);
      }

      // CRITICAL: Remove any remaining links or technical details
      return this.stripLinksAndTechnicalInfo(formatted);
    } catch (error) {
      this.logger.error(`Error formatting result for tool ${toolName}:`, error);
      return this.formatGenericResult(result);
    }
  }

  /**
   * Strip all links and technical information from formatted text
   */
  private stripLinksAndTechnicalInfo(text: string): string {
    if (!text) return text;

    // Remove Gmail links
    text = text.replace(/Link:\s*https:\/\/mail\.google\.com[^\s\n]*/gi, '');
    
    // Remove any other URLs
    text = text.replace(/https?:\/\/[^\s\n]*/gi, '');
    
    // Remove message IDs that might have slipped through
    text = text.replace(/Message ID:\s*[a-f0-9]+/gi, '');
    
    // Remove extra whitespace and empty lines
    text = text.replace(/\n\s*\n/g, '\n').trim();
    
    return text;
  }

  /**
   * Format email results - converts message IDs to human-readable format
   */
  private formatEmailResult(result: any): string {
    if (!result) return 'No emails found.';

    // Handle different email result structures
    if (Array.isArray(result)) {
      return this.formatEmailList(result);
    }

    if (result.emails && Array.isArray(result.emails)) {
      return this.formatEmailList(result.emails);
    }

    if (result.messages && Array.isArray(result.messages)) {
      return this.formatEmailList(result.messages);
    }

    // Single email
    if (result.subject || result.from) {
      return this.formatSingleEmail(result);
    }

    // If we can't parse it properly, return a generic message
    return 'Email operation completed successfully.';
  }

  /**
   * Format a list of emails
   */
  private formatEmailList(emails: any[]): string {
    if (!emails || emails.length === 0) {
      return 'No emails found.';
    }

    const formattedEmails = emails.map(email => this.formatSingleEmail(email)).filter(Boolean);
    
    if (formattedEmails.length === 0) {
      return `Found ${emails.length} emails, but couldn't extract subject/sender info.`;
    }

    return formattedEmails.join('\n');
  }

  /**
   * Format a single email
   */
  private formatSingleEmail(email: any): string {
    let subject = 'No Subject';
    let sender = 'Unknown Sender';

    // Extract subject
    if (email.subject) {
      subject = email.subject;
    } else if (email.snippet && email.snippet.length > 0) {
      // Use snippet as fallback for subject
      subject = email.snippet.substring(0, 50) + (email.snippet.length > 50 ? '...' : '');
    }

    // Extract sender
    if (email.from) {
      sender = this.extractSenderName(email.from);
    } else if (email.sender) {
      sender = this.extractSenderName(email.sender);
    } else if (email.fromName) {
      sender = email.fromName;
    }

    // NEVER include links or IDs - only subject and sender
    return `📧 ${subject} - from ${sender}`;
  }

  /**
   * Extract sender name from email address or formatted string
   */
  private extractSenderName(fromField: string): string {
    if (!fromField) return 'Unknown Sender';

    // Handle "Name <email@domain.com>" format
    const nameMatch = fromField.match(/^(.+?)\s*<.+>$/);
    if (nameMatch) {
      return nameMatch[1].trim().replace(/['"]/g, '');
    }

    // Handle just email address
    const emailMatch = fromField.match(/^([^@]+)@/);
    if (emailMatch) {
      // Convert email username to readable name
      return emailMatch[1]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
    }

    // Return as-is if no pattern matches
    return fromField;
  }

  /**
   * Format calendar results
   */
  private formatCalendarResult(result: any): string {
    if (!result) return 'Calendar operation completed.';

    if (result.summary || result.title) {
      const title = result.summary || result.title;
      const start = result.start ? new Date(result.start).toLocaleString() : '';
      return `📅 ${title}${start ? ` - ${start}` : ''}`;
    }

    return 'Calendar operation completed successfully.';
  }

  /**
   * Format other Google Workspace results
   */
  private formatGoogleWorkspaceResult(toolName: string, result: any): string {
    if (!result) return `${toolName} operation completed.`;

    // Handle document creation
    if (toolName.includes('doc') && result.title) {
      return `📄 Created document: ${result.title}`;
    }

    // Handle sheet creation
    if (toolName.includes('sheet') && result.title) {
      return `📊 Created spreadsheet: ${result.title}`;
    }

    // Handle drive operations
    if (toolName.includes('drive') && result.name) {
      return `💾 ${result.name}`;
    }

    return this.formatGenericResult(result);
  }

  /**
   * Format generic tool results
   */
  private formatGenericResult(result: any): string {
    if (typeof result === 'string') {
      return result;
    }

    if (result && typeof result === 'object') {
      // Try to extract meaningful information
      if (result.message) return result.message;
      if (result.status) return `Status: ${result.status}`;
      if (result.success) return 'Operation completed successfully.';
      
      // Last resort - return JSON but truncated
      const jsonStr = JSON.stringify(result, null, 2);
      return jsonStr.length > 200 ? jsonStr.substring(0, 200) + '...' : jsonStr;
    }

    return String(result || 'Operation completed.');
  }

  /**
   * Check if tool is email-related
   */
  private isEmailTool(toolName: string): boolean {
    const emailKeywords = ['gmail', 'email', 'mail', 'message', 'inbox'];
    return emailKeywords.some(keyword => toolName.toLowerCase().includes(keyword));
  }

  /**
   * Check if tool is calendar-related
   */
  private isCalendarTool(toolName: string): boolean {
    const calendarKeywords = ['calendar', 'event', 'meeting', 'appointment'];
    return calendarKeywords.some(keyword => toolName.toLowerCase().includes(keyword));
  }

  /**
   * Check if tool is Google Workspace-related
   */
  private isGoogleWorkspaceTool(toolName: string): boolean {
    const workspaceKeywords = ['docs', 'sheets', 'slides', 'drive', 'forms'];
    return workspaceKeywords.some(keyword => toolName.toLowerCase().includes(keyword));
  }

  /**
   * Format search results
   */
  formatSearchResult(result: any): string {
    if (!result) return 'No search results found.';

    if (Array.isArray(result)) {
      return result.map(item => this.formatSingleSearchResult(item)).join('\n\n');
    }

    return this.formatSingleSearchResult(result);
  }

  /**
   * Format a single search result
   */
  private formatSingleSearchResult(item: any): string {
    if (!item) return '';

    const title = item.title || item.name || 'Untitled';
    const snippet = item.snippet || item.description || '';
    const url = item.url || item.link || '';

    let formatted = `🔍 ${title}`;
    if (snippet) {
      formatted += `\n${snippet}`;
    }
    if (url) {
      formatted += `\n${url}`;
    }

    return formatted;
  }
}
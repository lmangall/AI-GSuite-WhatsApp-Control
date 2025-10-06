import { Injectable, Logger } from '@nestjs/common';
import { GoogleWorkspaceMCPService } from '../../mcp/google-workspace-mcp.service';

interface EmailSummary {
  subject: string;
  sender: string;
  snippet?: string;
}

@Injectable()
export class EmailHandlerService {
  private readonly logger = new Logger(EmailHandlerService.name);

  constructor(
    private readonly googleWorkspaceService: GoogleWorkspaceMCPService,
  ) {}

  /**
   * Get recent emails with actual subjects and senders
   */
  async getRecentEmails(options: {
    unreadOnly?: boolean;
    maxResults?: number;
    userEmail?: string;
  }): Promise<{ emails: EmailSummary[]; error?: string }> {
    const { unreadOnly = false, maxResults = 10, userEmail = 'l.mangallon@gmail.com' } = options;

    try {
      this.logger.log(`📧 Fetching ${unreadOnly ? 'unread' : 'recent'} emails for ${userEmail}`);

      // Step 1: Search for message IDs
      const query = unreadOnly ? 'is:unread in:inbox' : 'in:inbox';
      const searchResult = await this.googleWorkspaceService.callTool('search_gmail_messages', {
        query,
        user_google_email: userEmail,
        page_size: maxResults,
      });

      this.logger.debug(`Search result:`, searchResult);

      // Check for authentication errors
      if (this.isAuthError(searchResult)) {
        return { emails: [], error: this.extractAuthUrl(searchResult) };
      }

      // Extract message IDs from search result
      const messageIds = this.extractMessageIds(searchResult);
      
      if (messageIds.length === 0) {
        this.logger.log('No messages found');
        return { emails: [] };
      }

      this.logger.log(`Found ${messageIds.length} message IDs: ${messageIds.join(', ')}`);

      // Step 2: Get email content for these IDs
      const contentResult = await this.googleWorkspaceService.callTool('get_gmail_messages_content_batch', {
        message_ids: messageIds,
        user_google_email: userEmail,
        format: 'metadata', // Only get metadata (subject, from, etc.) not full body
      });

      this.logger.log(`Content result type: ${typeof contentResult}`);
      this.logger.log(`Content result preview: ${JSON.stringify(contentResult).substring(0, 1000)}...`);

      // Step 3: Parse and format emails
      const emails = this.parseEmailContent(contentResult);
      
      this.logger.log(`✅ Successfully retrieved ${emails.length} emails`);
      return { emails };

    } catch (error) {
      this.logger.error(`❌ Failed to get emails:`, error);
      return { 
        emails: [], 
        error: `Failed to retrieve emails: ${error.message}` 
      };
    }
  }

  /**
   * Format emails for display
   */
  formatEmailsForDisplay(emails: EmailSummary[]): string {
    if (emails.length === 0) {
      return "No emails found! 📭";
    }

    const formatted = emails.map((email) => {
      return `${email.subject} - from ${email.sender}`;
    });

    return formatted.join('\n\n'); // Double newline for better WhatsApp formatting
  }

  /**
   * Check if result contains authentication error
   */
  private isAuthError(result: any): boolean {
    const resultStr = JSON.stringify(result);
    return resultStr.includes('ACTION REQUIRED') || 
           resultStr.includes('Authentication Needed') ||
           resultStr.includes('Authorization URL');
  }

  /**
   * Extract authorization URL from error
   */
  private extractAuthUrl(result: any): string {
    const resultStr = JSON.stringify(result);
    const match = resultStr.match(/Authorization URL: (https:\/\/[^\s\n"]+)/);
    
    if (match && match[1]) {
      return `🔐 **Google Authentication Required**\n\nPlease authorize access:\n${match[1]}\n\nThen try again!`;
    }
    
    return '🔐 **Google Authentication Required**\n\nPlease check logs for authorization link.';
  }

  /**
   * Extract message IDs from search result
   */
  private extractMessageIds(result: any): string[] {
    try {
      // Handle different result formats
      let resultText = '';
      
      if (typeof result === 'string') {
        resultText = result;
      } else if (result?.content && Array.isArray(result.content)) {
        resultText = result.content[0]?.text || '';
      } else if (result?.text) {
        resultText = result.text;
      } else {
        resultText = JSON.stringify(result);
      }

      // Extract message IDs using regex
      const idPattern = /Message ID:\s*([a-zA-Z0-9]+)/g;
      const ids: string[] = [];
      let match;

      while ((match = idPattern.exec(resultText)) !== null) {
        ids.push(match[1]);
      }

      this.logger.debug(`Extracted ${ids.length} message IDs:`, ids);
      return ids;

    } catch (error) {
      this.logger.error('Failed to extract message IDs:', error);
      return [];
    }
  }

  /**
   * Parse email content from batch result
   */
  private parseEmailContent(result: any): EmailSummary[] {
    try {
      let resultText = '';
      
      if (typeof result === 'string') {
        resultText = result;
      } else if (result?.content && Array.isArray(result.content)) {
        resultText = result.content[0]?.text || '';
      } else if (result?.text) {
        resultText = result.text;
      } else {
        resultText = JSON.stringify(result);
      }

      this.logger.log(`Parsing email content, text length: ${resultText.length}`);
      this.logger.debug(`First 1000 chars: ${resultText.substring(0, 1000)}`);

      const emails: EmailSummary[] = [];
      
      // Split by message blocks - try different patterns
      let messageBlocks = resultText.split(/Message \d+:/);
      
      // If that didn't work, try splitting by "---" or other separators
      if (messageBlocks.length <= 1) {
        this.logger.debug('Trying alternative split pattern...');
        messageBlocks = resultText.split(/\n\n---\n\n|\n={3,}\n/);
      }
      
      this.logger.log(`Found ${messageBlocks.length} message blocks`);
      
      for (const block of messageBlocks) {
        if (!block.trim()) continue;

        const email: EmailSummary = {
          subject: 'No Subject',
          sender: 'Unknown',
        };

        // Extract subject
        const subjectMatch = block.match(/Subject:\s*(.+?)(?:\n|$)/);
        if (subjectMatch) {
          email.subject = subjectMatch[1].trim();
        }

        // Extract sender (from name and email)
        const fromMatch = block.match(/From:\s*(.+?)(?:\n|$)/);
        if (fromMatch) {
          const fromText = fromMatch[1].trim();
          // Extract just the name if format is "Name <email>"
          const nameMatch = fromText.match(/^([^<]+)/);
          if (nameMatch) {
            email.sender = nameMatch[1].trim();
          } else {
            email.sender = fromText;
          }
        }

        // Extract snippet if available
        const snippetMatch = block.match(/Snippet:\s*(.+?)(?:\n|$)/);
        if (snippetMatch) {
          email.snippet = snippetMatch[1].trim();
        }

        // Only add if we have at least a subject or sender
        if (email.subject !== 'No Subject' || email.sender !== 'Unknown') {
          emails.push(email);
        }
      }

      this.logger.debug(`Parsed ${emails.length} emails from content`);
      return emails;

    } catch (error) {
      this.logger.error('Failed to parse email content:', error);
      return [];
    }
  }
}

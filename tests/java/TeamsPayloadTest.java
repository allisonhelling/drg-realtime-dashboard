import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamsPayloadTest {
  record DocumentUpdatedEvent(
      String documentId,
      String documentName,
      String updatedBy,
      String updatedAtIso,
      String channelId
  ) {}

  interface TeamsClient {
    void postMessage(String channelId, String message);
  }

  static class RecordingTeamsClient implements TeamsClient {
    int calls = 0;
    String channelId = "";
    String message = "";

    @Override
    public void postMessage(String channelId, String message) {
      this.calls += 1;
      this.channelId = channelId;
      this.message = message;
    }
  }

  static class TeamsNotifier {
    static void notifyTeams(DocumentUpdatedEvent event, TeamsClient teamsClient) {
      String message =
          "Document updated: " + event.documentName() + "\n" +
          "Updated by: " + event.updatedBy() + "\n" +
          "Time: " + event.updatedAtIso();

      teamsClient.postMessage(event.channelId(), message);
    }
  }

  @Test
  void testNotificationOfUpdate() {
    var event = new DocumentUpdatedEvent(
        "doc-123",
        "Test Document.xlsx",
        "John Smith",
        "2026-01-29T14:56:00Z",
        "channel-abc"
    );

    var teamsClient = new RecordingTeamsClient();

    TeamsNotifier.notifyTeams(event, teamsClient);

    assertEquals(1, teamsClient.calls);
    assertEquals("channel-abc", teamsClient.channelId);
    assertTrue(teamsClient.message.contains("Test Document.xlsx"));
    assertTrue(teamsClient.message.contains("John Smith"));
  }
}

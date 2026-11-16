package de.taktwerk.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TaktWerkNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

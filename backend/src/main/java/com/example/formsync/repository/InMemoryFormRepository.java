package com.example.formsync.repository;

import com.example.formsync.model.FormState;
import org.springframework.stereotype.Repository;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 프로토타입용 인메모리 구현 (명세 §8.2). DB 없이 Map이 곧 진실의 원천.
 */
@Repository
public class InMemoryFormRepository implements FormRepository {

    private final Map<String, FormState> store = new ConcurrentHashMap<>();

    @Override
    public FormState load(String formId) {
        return store.get(formId);
    }

    @Override
    public void save(FormState state) {
        store.put(state.getFormId(), state);
    }
}
